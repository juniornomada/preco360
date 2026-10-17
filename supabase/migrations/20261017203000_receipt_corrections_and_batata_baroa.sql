-- Preserve the NFC-e's original declared price when the user corrects
-- the effective amount paid after discounts applied at the invoice subtotal.
alter table public.prices
  add column if not exists receipt_original_price numeric,
  add column if not exists manual_price_corrected_at timestamptz,
  add column if not exists manual_price_correction_note text;

comment on column public.prices.receipt_original_price is
  'Unmodified original NFC-e item price, retained after a manual effective-paid-price correction.';

-- Use the verified transparent product image already registered for this user.
-- Do not change any price or receipt row. Keep canonical_key for NFC-e dedup.
update public.products as p
set name = 'Batata-baroa (mandioquinha) kg',
    normalized_name = 'batata baroa mandioquinha kg',
    image_url = coalesce((
      select pi.image_url from public.product_images pi
      where pi.user_id = p.user_id
        and pi.normalized_name in ('batata baroa', 'batata baroa 1kg')
        and pi.status = 'verified'
      order by case when pi.normalized_name = 'batata baroa' then 0 else 1 end
      limit 1
    ), p.image_url),
    image_source = coalesce((
      select pi.image_source from public.product_images pi
      where pi.user_id=p.user_id and pi.normalized_name='batata baroa'
        and pi.status='verified'
      limit 1
    ), p.image_source),
    updated_at=now()
where p.name ~* '^mandioquinha( granel)?( 1?kg)?$'
  and lower(coalesce(p.unit,''))='kg';

-- Link the existing asset to the canonical product, without duplicating image bytes.
update public.product_images as pi
set product_id = p.id,
    updated_at = now()
from public.products as p
where pi.user_id=p.user_id
  and pi.normalized_name in ('batata baroa','batata baroa 1kg')
  and p.name='Batata-baroa (mandioquinha) kg'
  and pi.status='verified';

-- Improve the catalog display name for the abbreviated NFC-e product.
-- The original receipt_text and canonical_key are intentionally unchanged.
update public.products as p
set name='Cappuccino 3 Corações 200g',
    normalized_name='cappuccino 3 coracoes 200g',
    updated_at=now()
where p.name ~* '^CAPP[.]?3 CORACOES 200G$';
