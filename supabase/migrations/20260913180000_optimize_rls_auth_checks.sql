drop policy if exists "products_select_own" on public.products;
drop policy if exists "products_insert_own" on public.products;
drop policy if exists "products_update_own" on public.products;
drop policy if exists "products_delete_own" on public.products;
drop policy if exists "prices_select_own" on public.prices;
drop policy if exists "prices_insert_own" on public.prices;
drop policy if exists "prices_update_own" on public.prices;
drop policy if exists "prices_delete_own" on public.prices;

create policy "products_select_own"
on public.products for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "products_insert_own"
on public.products for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "products_update_own"
on public.products for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "products_delete_own"
on public.products for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "prices_select_own"
on public.prices for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "prices_insert_own"
on public.prices for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.products p
    where p.id = product_id and p.user_id = (select auth.uid())
  )
);

create policy "prices_update_own"
on public.prices for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.products p
    where p.id = product_id and p.user_id = (select auth.uid())
  )
);

create policy "prices_delete_own"
on public.prices for delete
to authenticated
using ((select auth.uid()) = user_id);
