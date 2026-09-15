create table if not exists public.flyers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  retailer text not null,
  title text,
  valid_from date,
  valid_to date,
  city text,
  source_type text not null default 'pdf' check (source_type in ('pdf','image','manual')),
  source_file_name text,
  source_file_path text,
  file_hash text,
  page_count integer,
  created_at timestamptz not null default now()
);

create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  retailer text,
  created_at timestamptz not null default now()
);

create table if not exists public.flyer_items (
  id uuid primary key default gen_random_uuid(),
  flyer_id uuid not null references public.flyers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_name text not null,
  normalized_name text,
  brand text,
  package_quantity numeric,
  package_unit text,
  advertised_price numeric not null check (advertised_price > 0),
  base_unit text,
  normalized_price numeric,
  club_price boolean not null default false,
  product_id uuid references public.products(id) on delete set null,
  match_confidence numeric,
  match_type text check (match_type in ('exact','equivalent','suggested','manual','unmatched')),
  source_page integer,
  created_at timestamptz not null default now()
);

create index if not exists flyers_user_created_idx on public.flyers(user_id, created_at desc);
create index if not exists flyers_user_valid_idx on public.flyers(user_id, valid_from desc, valid_to desc);
create unique index if not exists flyers_user_file_hash_uidx on public.flyers(user_id, file_hash) where file_hash is not null;
create index if not exists flyer_items_flyer_idx on public.flyer_items(flyer_id);
create index if not exists flyer_items_user_product_idx on public.flyer_items(user_id, product_id);
create index if not exists flyer_items_user_name_idx on public.flyer_items(user_id, normalized_name);
create index if not exists product_aliases_user_product_idx on public.product_aliases(user_id, product_id);
create unique index if not exists product_aliases_user_name_retailer_uidx on public.product_aliases(user_id, normalized_alias, coalesce(retailer, ''));

alter table public.flyers enable row level security;
alter table public.flyer_items enable row level security;
alter table public.product_aliases enable row level security;

create policy "flyers_select_own" on public.flyers for select using ((select auth.uid()) = user_id);
create policy "flyers_insert_own" on public.flyers for insert with check ((select auth.uid()) = user_id);
create policy "flyers_update_own" on public.flyers for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "flyers_delete_own" on public.flyers for delete using ((select auth.uid()) = user_id);
create policy "flyer_items_select_own" on public.flyer_items for select using ((select auth.uid()) = user_id);
create policy "flyer_items_insert_own" on public.flyer_items for insert with check ((select auth.uid()) = user_id);
create policy "flyer_items_update_own" on public.flyer_items for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "flyer_items_delete_own" on public.flyer_items for delete using ((select auth.uid()) = user_id);
create policy "product_aliases_select_own" on public.product_aliases for select using ((select auth.uid()) = user_id);
create policy "product_aliases_insert_own" on public.product_aliases for insert with check ((select auth.uid()) = user_id);
create policy "product_aliases_update_own" on public.product_aliases for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "product_aliases_delete_own" on public.product_aliases for delete using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public) values ('flyers', 'flyers', false) on conflict (id) do nothing;
create policy "flyers_storage_select_own" on storage.objects for select to authenticated using (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "flyers_storage_insert_own" on storage.objects for insert to authenticated with check (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "flyers_storage_update_own" on storage.objects for update to authenticated using (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "flyers_storage_delete_own" on storage.objects for delete to authenticated using (bucket_id = 'flyers' and (storage.foldername(name))[1] = (select auth.uid())::text);
