create table if not exists public.user_city_retailers (
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
  created_at timestamptz not null default now(),
  primary key (user_id, city_id, retailer_key)
);

alter table public.user_city_retailers enable row level security;

create policy "user_city_retailers_select_own"
on public.user_city_retailers for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "user_city_retailers_insert_own"
on public.user_city_retailers for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "user_city_retailers_delete_own"
on public.user_city_retailers for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, delete on public.user_city_retailers to authenticated;

create index if not exists user_city_retailers_city_idx
  on public.user_city_retailers (city_id, retailer_key);
