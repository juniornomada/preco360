create unique index if not exists flyers_user_file_hash_uidx
  on public.flyers (user_id, file_hash)
  where file_hash is not null;

create index if not exists flyer_import_jobs_user_hash_status_idx
  on public.flyer_import_jobs (user_id, file_hash, status, created_at desc)
  where file_hash is not null;

create unique index if not exists flyer_import_jobs_active_hash_uidx
  on public.flyer_import_jobs (user_id, file_hash)
  where file_hash is not null
    and status in ('queued','processing','refining');

create table if not exists public.flyer_source_registry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  retailer text not null,
  city text not null default 'Marília',
  source_key text not null,
  source_url text,
  source_title text,
  valid_from date,
  valid_to date,
  metadata_fingerprint text,
  etag text,
  last_modified text,
  content_length bigint,
  file_hash text,
  status text not null default 'seen'
    check (status in ('seen','unchanged','downloaded','processed','failed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_downloaded_at timestamptz,
  last_processed_at timestamptz,
  last_error text
);

alter table public.flyer_source_registry enable row level security;

drop policy if exists "Users can view own flyer source registry" on public.flyer_source_registry;
create policy "Users can view own flyer source registry"
  on public.flyer_source_registry
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own flyer source registry" on public.flyer_source_registry;
create policy "Users can insert own flyer source registry"
  on public.flyer_source_registry
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own flyer source registry" on public.flyer_source_registry;
create policy "Users can update own flyer source registry"
  on public.flyer_source_registry
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own flyer source registry" on public.flyer_source_registry;
create policy "Users can delete own flyer source registry"
  on public.flyer_source_registry
  for delete
  using ((select auth.uid()) = user_id);

create unique index if not exists flyer_source_registry_source_uidx
  on public.flyer_source_registry (
    user_id,
    lower(retailer),
    lower(city),
    source_key
  );

create index if not exists flyer_source_registry_validity_idx
  on public.flyer_source_registry (
    user_id,
    lower(retailer),
    lower(city),
    valid_from,
    valid_to
  );

create index if not exists flyer_source_registry_hash_idx
  on public.flyer_source_registry (user_id, file_hash)
  where file_hash is not null;
