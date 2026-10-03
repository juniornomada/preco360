-- Initial Bauru profile seed used to validate the dynamic retailer experience.
-- Population reference: IBGE Censo 2022 (municipality code 3506003).

update public.cities
set population = 379146,
    population_reference_year = 2022,
    retailer_target_count = 6
where ibge_code = '3506003';

with city as (
  select id from public.cities where ibge_code='3506003' limit 1
),
seed(retailer) as (
  values
    ('Atacadão'),
    ('Assaí'),
    ('Confiança'),
    ('Tauste'),
    ('Tenda Atacado'),
    ('Pão de Açúcar')
)
insert into public.retailer_city_availability (
  city_id, retailer, status, source_count, location_count,
  relevance_score, discovery_source, last_checked_at, discovered_at, notes
)
select
  city.id,
  seed.retailer,
  'discovered',
  0,
  1,
  1,
  'seed_verified',
  now(),
  now(),
  'Presença inicial confirmada por fontes públicas; a descoberta automática pode atualizar esta lista.'
from city cross join seed
on conflict (retailer, city_id) do update
set
  status = case when public.retailer_city_availability.status='available' then 'available' else 'discovered' end,
  discovery_source = case when public.retailer_city_availability.status='available'
    then public.retailer_city_availability.discovery_source else excluded.discovery_source end,
  location_count = greatest(public.retailer_city_availability.location_count, excluded.location_count),
  last_checked_at = now();
