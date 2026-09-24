
drop index if exists public.prices_store_observation_id_uidx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'prices_store_observation_id_key'
      and conrelid = 'public.prices'::regclass
  ) then
    alter table public.prices
      add constraint prices_store_observation_id_key unique (store_observation_id);
  end if;
end
$$;
