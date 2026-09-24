alter table public.prices
  drop constraint if exists prices_source_check;

alter table public.prices
  add constraint prices_source_check
  check (source = any (array[
    'manual'::text,
    'receipt'::text,
    'qr'::text,
    'import'::text,
    'store_observation'::text
  ]));
