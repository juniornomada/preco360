-- Backfill comparable receipt prices from the product package metadata.
-- This keeps old NFC-e history consistent with newer imports and allows
-- multipacks such as 6x85g (510g total) to be compared by R$/kg.

update public.prices as pr
set
  package_quantity = coalesce(pr.package_quantity, p.package_size),
  package_unit = coalesce(pr.package_unit, p.unit),
  normalized_price = coalesce(
    pr.normalized_price,
    case
      when lower(p.unit) = 'g' then pr.price / (p.package_size / 1000.0)
      when lower(p.unit) = 'kg' then pr.price / p.package_size
      when lower(p.unit) = 'ml' then pr.price / (p.package_size / 1000.0)
      when lower(p.unit) = 'l' then pr.price / p.package_size
      when lower(p.unit) in ('un','und','unid') then pr.price / p.package_size
      else null
    end
  ),
  base_unit = coalesce(
    pr.base_unit,
    case
      when lower(p.unit) in ('g','kg') then 'kg'
      when lower(p.unit) in ('ml','l') then 'l'
      when lower(p.unit) in ('un','und','unid') then 'un'
      else null
    end
  )
from public.products as p
where pr.product_id = p.id
  and pr.source = 'receipt'
  and pr.price is not null
  and pr.price > 0
  and p.package_size is not null
  and p.package_size > 0
  and lower(p.unit) in ('g','kg','ml','l','un','und','unid')
  and (
    pr.normalized_price is null
    or pr.base_unit is null
    or pr.package_quantity is null
    or pr.package_unit is null
  );
