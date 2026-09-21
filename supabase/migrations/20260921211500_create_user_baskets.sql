create table public.user_baskets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selection jsonb not null default '{}'::jsonb
    check (jsonb_typeof(selection) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_baskets_set_updated_at
before update on public.user_baskets
for each row execute function public.set_updated_at();

alter table public.user_baskets enable row level security;

create policy "user_baskets_select_own"
on public.user_baskets for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "user_baskets_insert_own"
on public.user_baskets for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "user_baskets_update_own"
on public.user_baskets for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "user_baskets_delete_own"
on public.user_baskets for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_baskets to authenticated;
