create index if not exists prices_user_product_date_created_idx
  on public.prices (user_id, product_id, date desc, created_at desc)
  include (price, supermarket, normalized_price, base_unit, package_quantity, package_unit);

create index if not exists store_price_observations_user_product_date_idx
  on public.store_price_observations (user_id, product_id, observed_date desc, created_at desc)
  include (retail_price, wholesale_price, supermarket, normalized_retail_price, base_unit)
  where product_id is not null;
