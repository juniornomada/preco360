alter table public.flyer_items
  add column if not exists club_advertised_price numeric,
  add column if not exists included_types text[] not null default '{}',
  add column if not exists excluded_types text[] not null default '{}',
  add column if not exists store_restrictions text[] not null default '{}',
  add column if not exists purchase_limit text,
  add column if not exists offer_notes text[] not null default '{}',
  add column if not exists extraction_confidence numeric,
  add column if not exists price_basis_quantity numeric,
  add column if not exists price_basis_unit text;

comment on column public.flyer_items.club_advertised_price is 'Optional Clube/Vantagens advertised price, separate from regular advertised_price.';
comment on column public.flyer_items.included_types is 'Variants/flavors/types explicitly included in the advertised offer.';
comment on column public.flyer_items.excluded_types is 'Variants/flavors/types explicitly excluded from the advertised offer.';
comment on column public.flyer_items.store_restrictions is 'Store/region restrictions copied from the flyer.';
comment on column public.flyer_items.purchase_limit is 'Human-readable purchase/customer limit from the flyer.';
comment on column public.flyer_items.offer_notes is 'Other offer conditions preserved from the original flyer.';
comment on column public.flyer_items.extraction_confidence is 'Vision extraction confidence from 0 to 1.';
comment on column public.flyer_items.price_basis_quantity is 'Quantity to which advertised_price directly applies, e.g. 100 for R$/100g.';
comment on column public.flyer_items.price_basis_unit is 'Unit to which advertised_price directly applies, e.g. g, kg, ml, l, un.';
