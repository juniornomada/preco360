-- Assertions AFTER the separate manual rollback script.
DO $check$
BEGIN
  IF (SELECT count(*) FROM public.product_taxonomy_rollback_snapshot_20261018)<>6
  THEN RAISE EXCEPTION 'Rollback deleted the protected snapshot'; END IF;

  IF EXISTS(SELECT 1 FROM public.products
    WHERE taxonomy_department IS NOT NULL OR taxonomy_category IS NOT NULL
      OR taxonomy_kind IS NOT NULL OR taxonomy_confidence IS NOT NULL)
  THEN RAISE EXCEPTION 'Catalog classification metadata remained after rollback'; END IF;

  IF EXISTS(SELECT 1 FROM public.flyer_items
    WHERE taxonomy_department IS NOT NULL OR taxonomy_category IS NOT NULL
      OR taxonomy_kind IS NOT NULL OR taxonomy_confidence IS NOT NULL)
  THEN RAISE EXCEPTION 'Flyer classification metadata remained after rollback'; END IF;

  -- Previous metadata must match, except the two intentional manual
  -- changes made *after* the migration; rollback must not overwrite them.
  IF EXISTS (SELECT 1 FROM public.products p
    JOIN public.product_taxonomy_rollback_snapshot_20261018 s
      ON p.id=s.product_id
    WHERE (p.package_size,p.unit)
      IS DISTINCT FROM (s.original_package_size,s.original_unit)
      OR (p.id NOT IN (
            '00000000-0000-4000-8000-000000000101'::uuid
          ) AND p.category IS DISTINCT FROM s.original_category)
      OR (p.id NOT IN (
            'e3e3f5c2-7b74-4d84-ae02-abac851255cd'::uuid
          ) AND (p.image_url,p.image_source)
              IS DISTINCT FROM (s.original_image_url,s.original_image_source)))
  THEN RAISE EXCEPTION 'Original metadata restoration incomplete'; END IF;

  IF (SELECT category FROM public.products
      WHERE id='00000000-0000-4000-8000-000000000101')
     IS DISTINCT FROM 'Minhas escolhas depois'
  THEN RAISE EXCEPTION 'Rollback overwrote user-entered category'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products
     WHERE id='e3e3f5c2-7b74-4d84-ae02-abac851255cd'
       AND image_source='manual_user_asset'
       AND image_url='https://example.invalid/my-photo.jpg')
  THEN RAISE EXCEPTION 'Rollback overwrote user-entered image'; END IF;

  IF (SELECT category FROM public.products WHERE id='00000000-0000-4000-8000-000000000105')
       IS DISTINCT FROM 'Geral'
  THEN RAISE EXCEPTION 'New product classification not rolled back'; END IF;

  IF (SELECT count(*) FROM public.prices)<>1
    OR (SELECT price FROM public.prices LIMIT 1) IS DISTINCT FROM 7.44
  THEN RAISE EXCEPTION 'Rollback damaged historic price'; END IF;

  IF EXISTS(SELECT 1 FROM pg_trigger
    WHERE tgname IN ('product_taxonomy_fill_v1','flyer_taxonomy_fill_v1')
      AND NOT tgisinternal)
  THEN RAISE EXCEPTION 'Automatic categorization trigger still active'; END IF;
END;
$check$;
