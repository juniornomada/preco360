alter table public.cities
  add column if not exists population bigint,
  add column if not exists population_reference_year integer,
  add column if not exists retailer_target_count integer;

update public.cities
set retailer_target_count = case
  when population is null then coalesce(retailer_target_count, 5)
  when population <= 100000 then 4
  when population <= 300000 then 5
  when population <= 700000 then 6
  when population <= 1500000 then 7
  else 8
end;

alter table public.cities
  alter column retailer_target_count set default 5;

alter table public.cities
  drop constraint if exists cities_retailer_target_count_check;

alter table public.cities
  add constraint cities_retailer_target_count_check
  check (retailer_target_count between 4 and 8);

alter table public.retailer_city_availability
  add column if not exists discovery_source text not null default 'manual',
  add column if not exists location_count integer not null default 0,
  add column if not exists relevance_score numeric(10,4),
  add column if not exists external_place_ids text[] not null default '{}'::text[],
  add column if not exists discovered_at timestamptz;

alter table public.retailer_city_availability
  drop constraint if exists retailer_city_availability_status_check;

alter table public.retailer_city_availability
  add constraint retailer_city_availability_status_check
  check (status = any (array['available'::text, 'discovered'::text, 'unavailable'::text, 'unknown'::text]));

create index if not exists retailer_city_availability_city_discovery_idx
  on public.retailer_city_availability (city_id, discovery_source, last_checked_at desc);
