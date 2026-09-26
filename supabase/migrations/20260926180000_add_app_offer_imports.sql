-- Support supermarket app screenshots as their own offer source.
alter table public.flyers
  drop constraint if exists flyers_source_type_check;

alter table public.flyers
  add constraint flyers_source_type_check
  check (source_type = any (array['pdf'::text,'image'::text,'manual'::text,'app'::text]));

create table if not exists public.app_offer_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  retailer text not null,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed')),
  progress_current integer not null default 0,
  progress_total integer not null default 0,
  progress_label text not null default '',
  source_files jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  warning_message text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  saved_at timestamptz null
);

create index if not exists app_offer_import_jobs_user_created_idx
  on public.app_offer_import_jobs(user_id, created_at desc);

create index if not exists app_offer_import_jobs_active_idx
  on public.app_offer_import_jobs(user_id, status, created_at desc)
  where saved_at is null;

alter table public.app_offer_import_jobs enable row level security;

drop policy if exists app_offer_import_jobs_select_own on public.app_offer_import_jobs;
create policy app_offer_import_jobs_select_own
  on public.app_offer_import_jobs for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists app_offer_import_jobs_insert_own on public.app_offer_import_jobs;
create policy app_offer_import_jobs_insert_own
  on public.app_offer_import_jobs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists app_offer_import_jobs_update_own on public.app_offer_import_jobs;
create policy app_offer_import_jobs_update_own
  on public.app_offer_import_jobs for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists app_offer_import_jobs_delete_own on public.app_offer_import_jobs;
create policy app_offer_import_jobs_delete_own
  on public.app_offer_import_jobs for delete
  to authenticated
  using ((select auth.uid()) = user_id);
