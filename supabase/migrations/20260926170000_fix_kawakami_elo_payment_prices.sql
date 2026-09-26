-- Kawakami 25-28/09/2026: the lower prices for these three products
-- are conditional on payment with Elo credit card, not loyalty/club prices.
-- Keep the condition in offer_notes, but use the regular advertised price
-- for normal offer comparison.

update public.flyer_items
set
  club_advertised_price = null,
  club_price = false
where id in (
  '3d9b1ec3-036b-4c2e-a93b-762e7919942f',
  '93b1f5b4-177a-4947-9812-bc94ec712815',
  'c5aa6a1e-63c5-4a3a-b73e-c56d377fe70a'
);
