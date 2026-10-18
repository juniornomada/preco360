-- MANUAL EMERGENCY ROLLBACK ONLY. This file is deliberately outside
-- supabase/migrations so it cannot run automatically on deployment.
--
-- Prerequisites: confirm snapshot table exists and contains pre-change rows.
-- Coordinate a short maintenance window. Revert the app deployment too.
-- Do not run this merely to retest categories; all changes are transactional.
--
-- This logical rollback does NOT restore an entire PostgreSQL database.
-- It preserves current prices, receipt texts, aliases, product IDs and dates.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $verify$
BEGIN
  IF to_regclass('public.product_taxonomy_rollback_snapshot_20261018') IS NULL THEN
    RAISE EXCEPTION 'Rollback snapshot not present. Stop; do not guess values.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_taxonomy_rollback_snapshot_20261018
  ) THEN
    RAISE EXCEPTION 'Rollback snapshot empty. Stop.';
  END IF;
END;
$verify$;

-- No future automatic recategorization while reverting the app.
DROP TRIGGER IF EXISTS product_taxonomy_fill_v1 ON public.products;
DROP TRIGGER IF EXISTS flyer_taxonomy_fill_v1 ON public.flyer_items;

-- Restore a previous category only when it still equals the automatic
-- high-confidence category. Preserve categories subsequently changed by user.
UPDATE public.products p
SET category = s.original_category
FROM public.product_taxonomy_rollback_snapshot_20261018 s
WHERE p.id = s.product_id
  AND p.user_id = s.user_id
  AND p.taxonomy_confidence = 'high'
  AND p.taxonomy_category IS NOT NULL
  AND p.category = p.taxonomy_category
  AND p.category IS DISTINCT FROM s.original_category;

-- Products created after the snapshot do not have original metadata.
-- If they still carry a classifier-generated high-confidence category,
-- return them to Geral. A user explicitly choosing that same category
-- is indistinguishable and should be reviewed if applicable.
UPDATE public.products p
SET category = 'Geral'
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_taxonomy_rollback_snapshot_20261018 s
  WHERE s.product_id = p.id AND s.user_id = p.user_id
)
  AND p.taxonomy_confidence = 'high'
  AND p.taxonomy_category IS NOT NULL
  AND p.category = p.taxonomy_category;

-- Restore exact previous image values only for the two URLs installed by
-- this release. Leave a subsequent manual image change untouched.
UPDATE public.products p
SET image_url = s.original_image_url,
    image_source = s.original_image_source
FROM public.product_taxonomy_rollback_snapshot_20261018 s
WHERE p.id = s.product_id AND p.user_id = s.user_id
  AND p.image_source = 'external_verified_name_package'
  AND (
    (p.id = 'e3e3f5c2-7b74-4d84-ae02-abac851255cd'::uuid
      AND p.image_url = 'https://tauste.com.br/media/catalog/product/cache/207e23213cf636ccdef205098cf3c8a3/1/4/1435561747774851.jpg')
    OR
    (p.id = 'f05ca0d7-06b1-488e-bc36-0c6fdc45b283'::uuid
      AND p.image_url = 'https://centralmaxsupermercados.com.br/imagens_site/7898123801054.jpg')
  )
  AND (p.image_url,p.image_source)
    IS DISTINCT FROM (s.original_image_url,s.original_image_source);

-- Return the Da Feira catalog row to original unfilled unit data, but only
-- if it still matches the release's 1 kg change.
UPDATE public.products p
SET package_size=s.original_package_size,
    unit=s.original_unit
FROM public.product_taxonomy_rollback_snapshot_20261018 s
WHERE p.id=s.product_id AND p.user_id=s.user_id
  AND p.id = 'f05ca0d7-06b1-488e-bc36-0c6fdc45b283'::uuid
  AND s.original_package_size IS NULL
  AND s.original_unit IS NULL
  AND p.package_size = 1
  AND lower(trim(p.unit))='kg';

-- Metadata columns are retained to avoid breaking still-running app versions;
-- clearing them is sufficient to deactivate this release's catalog tags.
UPDATE public.products
SET taxonomy_department=NULL, taxonomy_category=NULL,
    taxonomy_kind=NULL, taxonomy_confidence=NULL
WHERE taxonomy_department IS NOT NULL OR taxonomy_category IS NOT NULL
   OR taxonomy_kind IS NOT NULL OR taxonomy_confidence IS NOT NULL;

UPDATE public.flyer_items
SET taxonomy_department=NULL, taxonomy_category=NULL,
    taxonomy_kind=NULL, taxonomy_confidence=NULL
WHERE taxonomy_department IS NOT NULL OR taxonomy_category IS NOT NULL
   OR taxonomy_kind IS NOT NULL OR taxonomy_confidence IS NOT NULL;

-- Keep snapshot and rule registry for investigation.
-- Drop added columns/functions/indexes only in a separate reviewed migration
-- AFTER every running frontend/backend dependency has been reverted.
COMMIT;

-- Read-only post-rollback verification:
-- SELECT count(*) FROM public.prices;
-- SELECT count(*) FROM public.products WHERE taxonomy_category IS NOT NULL;
-- SELECT count(*) FROM public.flyer_items WHERE taxonomy_category IS NOT NULL;
-- SELECT p.name,p.category,s.original_category FROM public.products p
-- JOIN public.product_taxonomy_rollback_snapshot_20261018 s ON p.id=s.product_id
-- WHERE p.category IS DISTINCT FROM s.original_category;
