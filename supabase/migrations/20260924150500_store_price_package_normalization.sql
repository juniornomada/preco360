alter table public.prices
  add column if not exists package_quantity numeric null,
  add column if not exists package_unit text null,
  add column if not exists normalized_price numeric null,
  add column if not exists base_unit text null;

alter table public.store_price_observations
  add column if not exists normalized_retail_price numeric null,
  add column if not exists normalized_wholesale_price numeric null,
  add column if not exists base_unit text null;

comment on column public.prices.package_quantity is
  'Package quantity observed for this specific price row.';
comment on column public.prices.package_unit is
  'Package unit observed for this specific price row (ml, L, g, kg, un).';
comment on column public.prices.normalized_price is
  'Price normalized to the base unit for this specific observation (L, kg, un).';
comment on column public.prices.base_unit is
  'Base unit used by normalized_price (l, kg, un).';

comment on column public.store_price_observations.normalized_retail_price is
  'Retail price normalized from package_quantity/package_unit.';
comment on column public.store_price_observations.normalized_wholesale_price is
  'Wholesale price normalized from package_quantity/package_unit.';
comment on column public.store_price_observations.base_unit is
  'Base unit used by normalized store prices (l, kg, un).';
