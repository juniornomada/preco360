-- Original package photos matched to the exact product/weight/roll variant.
-- Guarded changes: do not override manual or existing validated images.
UPDATE public.products SET
  image_url = 'https://tauste.com.br/media/catalog/product/cache/207e23213cf636ccdef205098cf3c8a3/1/4/1435561747774851.jpg',
  image_source = 'external_verified_name_package'
WHERE id = 'e3e3f5c2-7b74-4d84-ae02-abac851255cd'::uuid
  AND upper(btrim(name)) = 'MASSA P/PASTEL SAO JUDAS 500G'
  AND (image_url IS NULL OR btrim(image_url) = '');

UPDATE public.products SET
  image_url = 'https://centralmaxsupermercados.com.br/imagens_site/7898123801054.jpg',
  image_source = 'external_verified_name_package'
WHERE id = 'f05ca0d7-06b1-488e-bc36-0c6fdc45b283'::uuid
  AND upper(btrim(name)) = 'MASSA PASTEL DA FEIRA'
  AND (image_url IS NULL OR btrim(image_url) = '');
