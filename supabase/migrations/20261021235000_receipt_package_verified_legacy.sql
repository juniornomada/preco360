begin;

-- Preserve the previous resolver as a base and layer exact legacy identities
-- on top without weakening its conservative generic rules.
alter function public.infer_receipt_package_v1(text,text)
  rename to infer_receipt_package_base_v1_20261021;

create or replace function public.infer_receipt_package_v1(
  p_name text,
  p_sale_unit text default null
)
returns table (
  package_size numeric,
  unit text,
  source text,
  confidence text
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v text := lower(unaccent(btrim(coalesce(p_name, ''))));
begin
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := btrim(v);

  -- Exact abbreviated identities verified against the retailer catalog.
  if v = 'brocolis japon ninja' then
    return query select 150::numeric, 'g'::text, 'verified-retailer'::text, 'high'::text;
    return;
  end if;

  if v = 'uva arra 15 s sement' then
    return query select 500::numeric, 'g'::text, 'verified-retailer'::text, 'high'::text;
    return;
  end if;

  -- Old receipt snapshots from this family lost the sale-unit field. The
  -- physical bottle size is unknown, so R$/un is an honest legacy fallback.
  if v ~ '^ref (coca cola|fanta)( |$)' then
    return query select 1::numeric, 'un'::text, 'legacy-unit-fallback'::text, 'fallback'::text;
    return;
  end if;

  return query
  select *
  from public.infer_receipt_package_base_v1_20261021(p_name, p_sale_unit);
end;
$$;

revoke all on function public.infer_receipt_package_v1(text,text) from public;
grant execute on function public.infer_receipt_package_v1(text,text) to authenticated;
revoke all on function public.infer_receipt_package_base_v1_20261021(text,text) from public;
grant execute on function public.infer_receipt_package_base_v1_20261021(text,text) to authenticated;

-- Preserve the exact old fiscal labels before enriching package metadata.
insert into public.product_aliases (
  user_id, product_id, alias, normalized_alias, retailer,
  package_size, unit, barcode, source, seen_count, last_seen_at
)
select
  p.user_id, p.id, p.name, public.normalize_product_alias(p.name), null,
  p.package_size, p.unit, nullif(btrim(p.barcode), ''), 'package-backfill-v3', 1, now()
from public.products p
where p.name in (
  'BROCOLIS JAPON/NINJA',
  'UVA ARRA 15 S/SEMENT',
  'REF COCA COLA',
  'REF COCA COLA ZER',
  'REF FANTA LAR',
  'REF FANTA UVA',
  'REF FANTA UVA ZERO'
)
on conflict (user_id, normalized_alias, (coalesce(retailer, ''::text))) do nothing;

with candidates as (
  select
    p.id,
    i.package_size,
    i.unit
  from public.products p
  cross join lateral public.infer_receipt_package_v1(p.name, null) i
  where p.name in (
    'BROCOLIS JAPON/NINJA',
    'UVA ARRA 15 S/SEMENT',
    'REF COCA COLA',
    'REF COCA COLA ZER',
    'REF FANTA LAR',
    'REF FANTA UVA',
    'REF FANTA UVA ZERO'
  )
)
update public.products p
set
  package_size = c.package_size,
  unit = c.unit,
  name = case
    when c.unit in ('g','kg','ml','l')
      then public.product_name_with_package_v1(p.name, c.package_size, c.unit)
    else p.name
  end,
  canonical_key = public.product_canonical_key(
    case
      when c.unit in ('g','kg','ml','l')
        then public.product_name_with_package_v1(p.name, c.package_size, c.unit)
      else p.name
    end,
    c.package_size,
    c.unit
  ),
  updated_at = now()
from candidates c
where p.id = c.id
  and (p.package_size is null or p.unit is null);

update public.product_aliases a
set
  package_size = coalesce(a.package_size, p.package_size),
  unit = coalesce(a.unit, p.unit)
from public.products p
where a.product_id = p.id
  and p.package_size is not null
  and p.unit is not null
  and (a.package_size is null or a.unit is null);

update public.prices pr
set
  package_quantity = coalesce(pr.package_quantity, p.package_size),
  package_unit = coalesce(pr.package_unit, p.unit),
  normalized_price = case
    when lower(p.unit) = 'g' then pr.price / (p.package_size / 1000.0)
    when lower(p.unit) = 'kg' then pr.price / p.package_size
    when lower(p.unit) = 'ml' then pr.price / (p.package_size / 1000.0)
    when lower(p.unit) = 'l' then pr.price / p.package_size
    when lower(p.unit) = 'un' then pr.price / p.package_size
    else pr.normalized_price
  end,
  base_unit = case
    when lower(p.unit) in ('g','kg') then 'kg'
    when lower(p.unit) in ('ml','l') then 'l'
    when lower(p.unit) = 'un' then 'un'
    else pr.base_unit
  end
from public.products p
where pr.product_id = p.id
  and pr.source = 'receipt'
  and pr.price > 0
  and p.package_size is not null
  and p.package_size > 0
  and p.unit is not null
  and (
    pr.package_quantity is null
    or pr.package_unit is null
    or pr.normalized_price is null
    or pr.base_unit is null
  );

commit;
