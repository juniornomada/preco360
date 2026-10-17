-- Keep immutable receipt evidence while allowing users to correct the effective
-- amount paid when a receipt-level discount is not allocated to an item.
create table if not exists public.receipt_price_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  price_id uuid not null references public.prices(id) on delete cascade,
  previous_price numeric(12,2) not null,
  corrected_price numeric(12,2) not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists receipt_price_adjustments_user_price_idx
  on public.receipt_price_adjustments (user_id,price_id,created_at desc);
alter table public.receipt_price_adjustments enable row level security;
create policy "receipt_price_adjustments_read_own"
  on public.receipt_price_adjustments for select to authenticated
  using ((select auth.uid())=user_id);
create policy "receipt_price_adjustments_insert_own"
  on public.receipt_price_adjustments for insert to authenticated
  with check ((select auth.uid())=user_id and exists (
    select 1 from public.prices p where p.id=price_id and p.user_id=(select auth.uid())
  ));
create or replace function public.correct_receipt_price_v1(
  p_price_id uuid,
  p_effective_price numeric,
  p_reason text default 'Desconto aplicado no total do cupom fiscal'
)
returns void language plpgsql security invoker set search_path=public as $$
declare
  current_row public.prices%rowtype;
  new_normalized_price numeric;
  pack_quantity numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_effective_price is null or p_effective_price <= 0 or p_effective_price > 100000 then
    raise exception 'Invalid effective price';
  end if;
  if nullif(trim(p_reason),'') is null or length(p_reason)>300 then
    raise exception 'A short correction reason is required';
  end if;
  select * into current_row from public.prices
    where id=p_price_id and user_id=auth.uid() for update;
  if not found then raise exception 'Price record not found'; end if;
  if current_row.source <> 'receipt' then
    raise exception 'Only imported receipt items can be corrected here';
  end if;
  if current_row.price = round(p_effective_price,2) then return; end if;
  pack_quantity := case
    when current_row.package_unit='g' then current_row.package_quantity/1000
    when current_row.package_unit='kg' then current_row.package_quantity
    when current_row.package_unit='ml' then current_row.package_quantity/1000
    when current_row.package_unit='l' then current_row.package_quantity
    when current_row.package_unit='un' then current_row.package_quantity
    else null end;
  if pack_quantity>0 then
    new_normalized_price:=round(round(p_effective_price,2)/pack_quantity,4);
  else
    new_normalized_price:=null;
  end if;
  insert into public.receipt_price_adjustments
    (user_id,price_id,previous_price,corrected_price,reason)
  values (auth.uid(),p_price_id,current_row.price,round(p_effective_price,2),trim(p_reason));
  update public.prices
  set price=round(p_effective_price,2),normalized_price=new_normalized_price
  where id=p_price_id and user_id=auth.uid();
end;
$$;
revoke all on function public.correct_receipt_price_v1(uuid,numeric,text) from public;
grant execute on function public.correct_receipt_price_v1(uuid,numeric,text) to authenticated;
grant select,insert on public.receipt_price_adjustments to authenticated;
