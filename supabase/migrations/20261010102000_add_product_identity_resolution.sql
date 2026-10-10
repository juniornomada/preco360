begin;

create extension if not exists unaccent;

alter table public.products
  add column if not exists canonical_key text;

alter table public.product_aliases
  add column if not exists package_size numeric,
  add column if not exists unit text,
  add column if not exists barcode text,
  add column if not exists source text,
  add column if not exists seen_count integer not null default 1,
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists products_user_canonical_key_idx
  on public.products(user_id, canonical_key)
  where canonical_key is not null and canonical_key <> '';

create unique index if not exists products_user_barcode_unique_idx
  on public.products(user_id, barcode)
  where barcode is not null and btrim(barcode) <> '';

create or replace function public.normalize_product_alias(p_name text)
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := lower(unaccent(coalesce(p_name, '')));
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  return btrim(v);
end;
$$;

create or replace function public.product_canonical_key(
  p_name text,
  p_package_size numeric default null,
  p_unit text default null
)
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v text;
  u text;
  pkg text := '';
begin
  v := lower(unaccent(coalesce(p_name, '')));

  v := regexp_replace(v, '([0-9]+([,.][0-9]+)?)\s*(litros?|lts?|lt)\M', '\1 l', 'gi');
  v := regexp_replace(v, '([0-9]+([,.][0-9]+)?)\s*(mililitros?|ml)\M', '\1 ml', 'gi');
  v := regexp_replace(v, '([0-9]+([,.][0-9]+)?)\s*(quilos?|kgs?|kg)\M', '\1 kg', 'gi');
  v := regexp_replace(v, '([0-9]+([,.][0-9]+)?)\s*(gramas?|grs?|gr|g)\M', '\1 g', 'gi');

  v := regexp_replace(
    v,
    '\m(refrigerante|refrig|garrafa|pet|embalagem|emb)\M',
    ' ',
    'gi'
  );

  if p_package_size is not null and coalesce(trim(p_unit), '') <> '' then
    v := regexp_replace(
      v,
      '\m[0-9]+([,.][0-9]+)?\s*(ml|litros?|lts?|lt|l|gramas?|grs?|gr|g|quilos?|kgs?|kg|un|und|unid)\M',
      ' ',
      'gi'
    );
    u := lower(trim(p_unit));
    if u in ('lt','lts','litro','litros') then u := 'l'; end if;
    if u in ('und','unid') then u := 'un'; end if;
    pkg := '|pkg=' || trim(to_char(p_package_size, 'FM999999990.####')) || u;
  end if;

  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := btrim(v);

  return v || pkg;
end;
$$;

update public.products
set canonical_key = public.product_canonical_key(name, package_size, unit);

insert into public.product_aliases (
  user_id, product_id, alias, normalized_alias, retailer,
  package_size, unit, barcode, source
)
select
  p.user_id,
  p.id,
  p.name,
  public.normalize_product_alias(p.name),
  null,
  p.package_size,
  p.unit,
  nullif(btrim(p.barcode), ''),
  'existing-product'
from public.products p
on conflict (user_id, normalized_alias, (coalesce(retailer, ''::text))) do nothing;

create or replace function public.resolve_or_create_product_identity(
  p_name text,
  p_package_size numeric default null,
  p_unit text default null,
  p_barcode text default null,
  p_retailer text default null,
  p_source text default 'receipt'
)
returns table (
  product_id uuid,
  created boolean,
  matched_by text,
  canonical_key text
)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_barcode text := nullif(regexp_replace(coalesce(p_barcode, ''), '\D', '', 'g'), '');
  v_alias text;
  v_retailer text := nullif(btrim(coalesce(p_retailer, '')), '');
  v_canonical text;
  v_product public.products%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if v_name = '' then
    raise exception 'Product name is required';
  end if;

  v_alias := public.normalize_product_alias(v_name);
  v_canonical := public.product_canonical_key(v_name, p_package_size, p_unit);

  if v_barcode is not null then
    select p.* into v_product
    from public.products p
    where p.user_id = v_uid and p.barcode = v_barcode
    order by p.created_at asc
    limit 1;

    if found then
      product_id := v_product.id;
      created := false;
      matched_by := 'barcode';
      canonical_key := coalesce(v_product.canonical_key, v_canonical);
    end if;
  end if;

  if product_id is null and v_retailer is not null then
    select p.* into v_product
    from public.product_aliases a
    join public.products p on p.id = a.product_id
    where a.user_id = v_uid
      and a.normalized_alias = v_alias
      and a.retailer = v_retailer
    limit 1;

    if found then
      product_id := v_product.id;
      created := false;
      matched_by := 'alias-retailer';
      canonical_key := coalesce(v_product.canonical_key, v_canonical);
    end if;
  end if;

  if product_id is null then
    select p.* into v_product
    from public.product_aliases a
    join public.products p on p.id = a.product_id
    where a.user_id = v_uid
      and a.normalized_alias = v_alias
      and a.retailer is null
    limit 1;

    if found then
      product_id := v_product.id;
      created := false;
      matched_by := 'alias-global';
      canonical_key := coalesce(v_product.canonical_key, v_canonical);
    end if;
  end if;

  if product_id is null and v_canonical <> '' then
    select p.* into v_product
    from public.products p
    left join lateral (
      select count(*)::int as price_count
      from public.prices pr
      where pr.product_id = p.id and pr.user_id = v_uid
    ) h on true
    where p.user_id = v_uid
      and p.canonical_key = v_canonical
    order by h.price_count desc, p.created_at asc
    limit 1;

    if found then
      product_id := v_product.id;
      created := false;
      matched_by := 'canonical';
      canonical_key := v_canonical;
    end if;
  end if;

  if product_id is null then
    insert into public.products (
      user_id, name, category, barcode, package_size, unit, canonical_key
    )
    values (
      v_uid,
      v_name,
      'Geral',
      v_barcode,
      p_package_size,
      p_unit,
      v_canonical
    )
    returning * into v_product;

    product_id := v_product.id;
    created := true;
    matched_by := 'created';
    canonical_key := v_canonical;
  else
    update public.products
    set
      canonical_key = coalesce(nullif(canonical_key, ''), v_canonical),
      barcode = case
        when (barcode is null or btrim(barcode) = '') and v_barcode is not null then v_barcode
        else barcode
      end,
      package_size = coalesce(package_size, p_package_size),
      unit = coalesce(unit, p_unit)
    where id = product_id and user_id = v_uid;
  end if;

  insert into public.product_aliases (
    user_id, product_id, alias, normalized_alias, retailer,
    package_size, unit, barcode, source, seen_count, last_seen_at
  )
  values (
    v_uid, product_id, v_name, v_alias, v_retailer,
    p_package_size, p_unit, v_barcode, p_source, 1, now()
  )
  on conflict (user_id, normalized_alias, (coalesce(retailer, ''::text)))
  do update set
    product_id = excluded.product_id,
    package_size = coalesce(excluded.package_size, public.product_aliases.package_size),
    unit = coalesce(excluded.unit, public.product_aliases.unit),
    barcode = coalesce(excluded.barcode, public.product_aliases.barcode),
    source = coalesce(excluded.source, public.product_aliases.source),
    seen_count = public.product_aliases.seen_count + 1,
    last_seen_at = now();

  return next;
end;
$$;

grant execute on function public.resolve_or_create_product_identity(
  text, numeric, text, text, text, text
) to authenticated;

commit;
