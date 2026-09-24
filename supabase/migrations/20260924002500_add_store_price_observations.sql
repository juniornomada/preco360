create table if not exists public.store_price_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid null references public.products(id) on delete set null,
  supermarket text not null,
  observed_date date not null default current_date,
  raw_name text not null,
  normalized_name text null,
  brand text null,
  barcode text null,
  package_quantity numeric null,
  package_unit text null,
  retail_price numeric not null check (retail_price > 0),
  wholesale_price numeric null check (wholesale_price is null or wholesale_price > 0),
  wholesale_min_quantity integer null check (wholesale_min_quantity is null or wholesale_min_quantity > 0),
  price_basis_quantity numeric null,
  price_basis_unit text null,
  source_image_path text null,
  source_file_name text null,
  source_hash text not null,
  extraction_confidence numeric null check (extraction_confidence is null or extraction_confidence between 0 and 1),
  match_confidence numeric null check (match_confidence is null or match_confidence between 0 and 1),
  match_type text null,
  notes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (user_id, source_hash)
);

create index if not exists store_price_observations_user_date_idx
  on public.store_price_observations(user_id, observed_date desc);
create index if not exists store_price_observations_product_date_idx
  on public.store_price_observations(product_id, observed_date desc)
  where product_id is not null;

alter table public.store_price_observations enable row level security;

drop policy if exists store_price_observations_select_own on public.store_price_observations;
create policy store_price_observations_select_own
  on public.store_price_observations for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists store_price_observations_insert_own on public.store_price_observations;
create policy store_price_observations_insert_own
  on public.store_price_observations for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      product_id is null
      or exists (
        select 1 from public.products p
        where p.id = product_id and p.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists store_price_observations_update_own on public.store_price_observations;
create policy store_price_observations_update_own
  on public.store_price_observations for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      product_id is null
      or exists (
        select 1 from public.products p
        where p.id = product_id and p.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists store_price_observations_delete_own on public.store_price_observations;
create policy store_price_observations_delete_own
  on public.store_price_observations for delete
  to authenticated
  using ((select auth.uid()) = user_id);

alter table public.prices
  add column if not exists store_observation_id uuid null
    references public.store_price_observations(id) on delete set null;

create unique index if not exists prices_store_observation_id_uidx
  on public.prices(store_observation_id)
  where store_observation_id is not null;
