create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'Geral',
  brand text,
  barcode text,
  unit text,
  package_size numeric,
  stockable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supermarket text not null,
  price numeric(12,2) not null check (price > 0),
  date date not null default current_date,
  source text not null default 'manual' check (source in ('manual','receipt','qr','import')),
  image_url text,
  receipt_text text,
  created_at timestamptz not null default now()
);

create index products_user_id_idx on public.products(user_id);
create index products_user_name_idx on public.products(user_id, lower(name));
create index prices_user_id_idx on public.prices(user_id);
create index prices_product_id_idx on public.prices(product_id);
create index prices_product_date_idx on public.prices(product_id, date desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

alter table public.products enable row level security;
alter table public.prices enable row level security;

create policy "products_select_own"
on public.products for select
to authenticated
using (auth.uid() = user_id);

create policy "products_insert_own"
on public.products for insert
to authenticated
with check (auth.uid() = user_id);

create policy "products_update_own"
on public.products for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "products_delete_own"
on public.products for delete
to authenticated
using (auth.uid() = user_id);

create policy "prices_select_own"
on public.prices for select
to authenticated
using (auth.uid() = user_id);

create policy "prices_insert_own"
on public.prices for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.products p
    where p.id = product_id and p.user_id = auth.uid()
  )
);

create policy "prices_update_own"
on public.prices for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.products p
    where p.id = product_id and p.user_id = auth.uid()
  )
);

create policy "prices_delete_own"
on public.prices for delete
to authenticated
using (auth.uid() = user_id);
