-- Mandatory safeguard. This migration sorts BEFORE the category, package,
-- image and backfill migrations. Run it before any production data changes.
-- The snapshot records only product metadata targeted by this release.
-- It does not duplicate price/receipt history and is NOT a database backup.
CREATE TABLE IF NOT EXISTS public.product_taxonomy_rollback_snapshot_20261018 (
  product_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  original_category text NOT NULL,
  original_package_size numeric,
  original_unit text,
  original_image_url text,
  original_image_source text,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_taxonomy_rollback_snapshot_20261018
  ENABLE ROW LEVEL SECURITY;
-- No policies for app clients. Backups are accessible only through an
-- authorized administrative connection; never expose cross-user data.
REVOKE ALL ON TABLE public.product_taxonomy_rollback_snapshot_20261018
  FROM PUBLIC, anon, authenticated;
INSERT INTO public.product_taxonomy_rollback_snapshot_20261018 (
  product_id, user_id, original_category, original_package_size,
  original_unit, original_image_url, original_image_source
)
SELECT id, user_id, category, package_size, unit, image_url, image_source
FROM public.products
ON CONFLICT (product_id) DO NOTHING;

-- Fail before later migrations if the initial capture was incomplete.
DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.products AS p
    LEFT JOIN public.product_taxonomy_rollback_snapshot_20261018 AS s
      ON s.product_id = p.id AND s.user_id = p.user_id
    WHERE s.product_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Product taxonomy snapshot incomplete. Abort migration.';
  END IF;
END;
$check$;
