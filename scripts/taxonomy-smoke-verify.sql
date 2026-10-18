-- Assertions AFTER every taxonomy migration has been applied.
DO $check$
DECLARE
  k text;
  c text;
BEGIN
  IF (SELECT count(*) FROM public.product_taxonomy_rollback_snapshot_20261018) <> 6
  THEN RAISE EXCEPTION 'Missing pre-migration product snapshot'; END IF;
  IF (SELECT count(*) FROM public.product_taxonomy_rules) <> 185
  THEN RAISE EXCEPTION 'Expected exactly 185 taxonomy rules'; END IF;

  IF (SELECT category FROM public.products WHERE id='e3e3f5c2-7b74-4d84-ae02-abac851255cd')
       IS DISTINCT FROM 'Massa para pastel'
  THEN RAISE EXCEPTION 'Pastry dough classification failed'; END IF;

  IF (SELECT category FROM public.products WHERE id='f05ca0d7-06b1-488e-bc36-0c6fdc45b283')
       IS DISTINCT FROM 'Massa para pastel'
  THEN RAISE EXCEPTION 'Da Feira category failed'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products
    WHERE id='f05ca0d7-06b1-488e-bc36-0c6fdc45b283' AND package_size=1 AND unit='kg'
      AND image_source='external_verified_name_package')
  THEN RAISE EXCEPTION 'Da Feira verified package/image update failed'; END IF;

  IF (SELECT category FROM public.products WHERE id='00000000-0000-4000-8000-000000000101')
       IS DISTINCT FROM 'Batata-baroa / mandioquinha'
  THEN RAISE EXCEPTION 'Batata baroa category failed'; END IF;

  IF (SELECT category FROM public.products WHERE id='00000000-0000-4000-8000-000000000102')
       IS DISTINCT FROM 'Geral'
  THEN RAISE EXCEPTION 'Unknown batata must stay unclassified'; END IF;

  IF (SELECT category FROM public.products WHERE id='00000000-0000-4000-8000-000000000103')
       IS DISTINCT FROM 'Minhas compras'
  THEN RAISE EXCEPTION 'User-selected category overwritten'; END IF;

  IF (SELECT category FROM public.products WHERE id='00000000-0000-4000-8000-000000000104')
       IS DISTINCT FROM 'Pão de queijo'
  THEN RAISE EXCEPTION 'Pao qjo fiscal abbreviation unclassified'; END IF;

  IF (SELECT taxonomy_kind FROM public.flyer_items WHERE id='00000000-0000-4000-8000-000000000201')
       IS DISTINCT FROM 'batata:potatoFreshBaroa'
  THEN RAISE EXCEPTION 'Flyer baroa category failed'; END IF;

  IF (SELECT taxonomy_kind FROM public.flyer_items WHERE id='00000000-0000-4000-8000-000000000202')
       IS DISTINCT FROM 'batata:potatoFreshCommon'
  THEN RAISE EXCEPTION 'Flyer inglesa category failed'; END IF;

  IF (SELECT taxonomy_kind FROM public.flyer_items WHERE id='00000000-0000-4000-8000-000000000203')
       IS DISTINCT FROM 'batata:potatoStraw'
  THEN RAISE EXCEPTION 'Flyer palha category failed'; END IF;

  IF EXISTS (SELECT 1 FROM public.flyer_items
    WHERE id='00000000-0000-4000-8000-000000000204'
      AND taxonomy_kind IS NOT NULL)
  THEN RAISE EXCEPTION 'Unknown potato flyer gained category'; END IF;

  IF (SELECT count(*) FROM public.prices)<>1
    OR (SELECT price FROM public.prices LIMIT 1) IS DISTINCT FROM 7.44
  THEN RAISE EXCEPTION 'Historical price changed'; END IF;

  IF has_table_privilege('authenticated', 'public.product_taxonomy_rollback_snapshot_20261018','SELECT')
  THEN RAISE EXCEPTION 'Snapshot exposed to authenticated client'; END IF;

  IF NOT has_table_privilege('authenticated','public.product_taxonomy_rules','SELECT')
  THEN RAISE EXCEPTION 'Cannot read product taxonomy rules'; END IF;
END;
$check$;

-- The triggers must work for new rows, not only the historical backfill.
INSERT INTO public.products(id,user_id,name)
VALUES ('00000000-0000-4000-8000-000000000105',
        '11111111-1111-4111-8111-111111111111','BATATA INGLESA KG');
INSERT INTO public.flyer_items(id,user_id,raw_name)
VALUES ('00000000-0000-4000-8000-000000000207',
        '11111111-1111-4111-8111-111111111111','BATATA DOCE 1KG');

-- A user might make manual changes after the migration. Rollback must not
-- overwrite these later choices.
UPDATE public.products
SET category='Minhas escolhas depois'
WHERE id='00000000-0000-4000-8000-000000000101';

UPDATE public.products
SET image_url='https://example.invalid/my-photo.jpg',
    image_source='manual_user_asset'
WHERE id='e3e3f5c2-7b74-4d84-ae02-abac851255cd';


DO $check$
BEGIN
  IF (SELECT category FROM public.products WHERE id='00000000-0000-4000-8000-000000000105')
     IS DISTINCT FROM 'Batata in natura'
  THEN RAISE EXCEPTION 'New product trigger failed'; END IF;
  IF (SELECT taxonomy_kind FROM public.flyer_items WHERE id='00000000-0000-4000-8000-000000000207')
     IS DISTINCT FROM 'batata:potatoFreshSweet'
  THEN RAISE EXCEPTION 'New flyer trigger failed'; END IF;
END;
$check$;
