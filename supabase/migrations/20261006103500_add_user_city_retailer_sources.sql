create table if not exists public.user_city_retailer_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete cascade,
  retailer text not null,
  retailer_key text generated always as (
    lower(regexp_replace(
      translate(retailer,
        'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
      ),
      '[^a-zA-Z0-9]+', ' ', 'g'
    ))
  ) stored,
  official_site_url text,
  offers_url text,
  source_type text,
  source_status text not null default 'unverified',
  city_verified boolean not null default false,
  capture_supported boolean not null default false,
  collector_key text,
  discovery_method text,
  last_http_status integer,
  last_sync_at timestamptz,
  last_offer_seen_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, city_id, retailer_key),
  constraint user_city_retailer_sources_status_check
    check (source_status = any (array[
      'unverified'::text,
      'available'::text,
      'no_offer'::text,
      'site_not_found'::text,
      'temporary_error'::text,
      'review'::text
    ])),
  constraint user_city_retailer_sources_type_check
    check (source_type is null or source_type = any (array[
      'pdf'::text,
      'image'::text,
      'web'::text,
      'web_catalog'::text,
      'api'::text
    ]))
);

drop trigger if exists user_city_retailer_sources_set_updated_at
on public.user_city_retailer_sources;

create trigger user_city_retailer_sources_set_updated_at
before update on public.user_city_retailer_sources
for each row execute function public.set_updated_at();

alter table public.user_city_retailer_sources enable row level security;

create policy "user_city_retailer_sources_select_own"
on public.user_city_retailer_sources for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "user_city_retailer_sources_insert_own"
on public.user_city_retailer_sources for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "user_city_retailer_sources_update_own"
on public.user_city_retailer_sources for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "user_city_retailer_sources_delete_own"
on public.user_city_retailer_sources for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete
on public.user_city_retailer_sources
to authenticated;

create index if not exists user_city_retailer_sources_city_status_idx
  on public.user_city_retailer_sources (city_id, source_status, retailer_key);
