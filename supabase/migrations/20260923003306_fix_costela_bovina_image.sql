-- Correct the verified image for the current Kawakami Costela Bovina offer.
-- Reuse the already verified raw beef-rib asset from the product image library.

update public.product_images
set
  image_url = 'https://hwpsnipdkwxvvjowomlo.supabase.co/storage/v1/object/public/product-images/e596fdb9-5827-438a-a01a-f452822ad757/238475f95c9d40964d399d7e6c859bbe2e4d4dc79cc3a93a79f7f40e86796a3c.webp',
  image_source = 'duckduckgo',
  external_code = 'https://www.casacarne.com.br/boi/costela-bovina-em-tiras-1-35kg',
  confidence = 0.95,
  status = 'verified',
  search_query = 'correcao manual: costela bovina corte fresco',
  storage_path = 'e596fdb9-5827-438a-a01a-f452822ad757/238475f95c9d40964d399d7e6c859bbe2e4d4dc79cc3a93a79f7f40e86796a3c.webp',
  source_url = 'https://images.tcdn.com.br/img/img_prod/1074417/costela_bovina_em_tiras_1_35kg_353_1_ab991a0b6c0d6a78643eb43b04596eb3.jpg',
  updated_at = now()
where id = 'd4611c05-c2f1-4477-84b4-713b186fd1c0';

update public.flyer_items
set
  image_url = 'https://hwpsnipdkwxvvjowomlo.supabase.co/storage/v1/object/public/product-images/e596fdb9-5827-438a-a01a-f452822ad757/238475f95c9d40964d399d7e6c859bbe2e4d4dc79cc3a93a79f7f40e86796a3c.webp',
  image_source = 'product_library',
  image_confidence = 0.95,
  image_match_status = 'verified',
  image_query = 'correcao manual: costela bovina corte fresco',
  image_storage_path = 'e596fdb9-5827-438a-a01a-f452822ad757/238475f95c9d40964d399d7e6c859bbe2e4d4dc79cc3a93a79f7f40e86796a3c'
where id = '8a15ca6a-fbfb-4073-ba06-0bb1fe1dfa3d';
