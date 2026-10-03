alter table public.cities
  add column if not exists search_name text;

update public.cities
set search_name = lower(
  translate(
    name,
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
  )
)
where search_name is null or search_name = '';

alter table public.cities
  alter column search_name set not null;

create index if not exists cities_search_name_prefix_idx
  on public.cities (search_name text_pattern_ops);

create unique index if not exists cities_ibge_code_unique_idx
  on public.cities (ibge_code)
  where ibge_code is not null;
