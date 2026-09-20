update public.flyer_items fi
set offer_notes = array_append(
  coalesce(fi.offer_notes, array[]::text[]),
  'Ativar desconto no app'
)
from public.flyers f
where f.id = fi.flyer_id
  and lower(f.retailer) = 'max atacadista'
  and fi.club_advertised_price is not null
  and fi.club_advertised_price > 0
  and not exists (
    select 1
    from unnest(coalesce(fi.offer_notes, array[]::text[])) n
    where lower(n) like '%app%'
  );
