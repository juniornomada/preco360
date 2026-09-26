-- Guard Kawakami promotions that are conditional on Cartão Elo.
-- These are payment-condition discounts, not loyalty-club prices.

create or replace function public.guard_kawakami_elo_promo()
returns trigger
language plpgsql
as $$
declare
  flyer_retailer text;
  notes_text text;
begin
  select retailer
    into flyer_retailer
  from public.flyers
  where id = new.flyer_id;

  notes_text := lower(coalesce(array_to_string(new.offer_notes, ' '), ''));

  if lower(coalesce(flyer_retailer, '')) like '%kawakami%'
     and (
       notes_text like '%cartão elo%'
       or notes_text like '%cartao elo%'
       or notes_text like '%com elo%'
     )
  then
    new.club_price := false;
    new.club_advertised_price := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_kawakami_elo_promo on public.flyer_items;

create trigger trg_guard_kawakami_elo_promo
before insert or update on public.flyer_items
for each row
execute function public.guard_kawakami_elo_promo();
