begin;

create table if not exists public.receipt_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_key text,
  receipt_fingerprint text not null,
  supermarket text not null,
  receipt_date date not null,
  source text not null default 'receipt',
  original_line_count integer,
  saved_price_count integer not null default 0,
  imported_at timestamptz not null default now(),
  constraint receipt_imports_access_key_format
    check (access_key is null or access_key ~ '^[0-9]{44}$')
);

create unique index if not exists receipt_imports_user_access_key_uidx
  on public.receipt_imports(user_id, access_key)
  where access_key is not null;

create unique index if not exists receipt_imports_user_fingerprint_uidx
  on public.receipt_imports(user_id, receipt_fingerprint);

create index if not exists receipt_imports_user_imported_idx
  on public.receipt_imports(user_id, imported_at desc);

alter table public.receipt_imports enable row level security;

drop policy if exists receipt_imports_select_own on public.receipt_imports;
create policy receipt_imports_select_own
on public.receipt_imports for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists receipt_imports_insert_own on public.receipt_imports;
create policy receipt_imports_insert_own
on public.receipt_imports for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists receipt_imports_update_own on public.receipt_imports;
create policy receipt_imports_update_own
on public.receipt_imports for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists receipt_imports_delete_own on public.receipt_imports;
create policy receipt_imports_delete_own
on public.receipt_imports for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.receipt_batch_fingerprint(
  p_supermarket text,
  p_date date,
  p_items jsonb
)
returns text
language sql
stable
set search_path = public, extensions
as $$
  with items as (
    select
      public.normalize_product_alias(coalesce(value->>'name', '')) as name_key,
      coalesce(
        trim(to_char(nullif(value->>'price', '')::numeric, 'FM999999990.000000')),
        ''
      ) as price_key,
      coalesce(
        trim(to_char(nullif(value->>'total_price', '')::numeric, 'FM999999990.000000')),
        ''
      ) as total_key,
      coalesce(
        trim(to_char(nullif(value->>'package_quantity', '')::numeric, 'FM999999990.000000')),
        ''
      ) as package_key,
      lower(btrim(coalesce(value->>'package_unit', ''))) as unit_key
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ),
  canonical as (
    select
      lower(unaccent(btrim(coalesce(p_supermarket, ''))))
        || '|' || coalesce(p_date::text, '')
        || '|' ||
        coalesce(
          string_agg(
            name_key || '|' || price_key || '|' || total_key || '|' ||
            package_key || '|' || unit_key,
            E'\n'
            order by name_key, price_key, total_key, package_key, unit_key
          ),
          ''
        ) as payload
    from items
  )
  select encode(digest(payload, 'sha256'), 'hex')
  from canonical;
$$;

create or replace function public.get_receipt_import_status(
  p_access_key text
)
returns table (
  already_imported boolean,
  imported_at timestamptz,
  supermarket text,
  receipt_date date,
  saved_price_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := nullif(regexp_replace(coalesce(p_access_key, ''), '\D', '', 'g'), '');
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    true,
    r.imported_at,
    r.supermarket,
    r.receipt_date,
    r.saved_price_count
  from public.receipt_imports r
  where r.user_id = v_uid
    and r.access_key = v_key
  order by r.imported_at desc
  limit 1;

  if not found then
    already_imported := false;
    imported_at := null;
    supermarket := null;
    receipt_date := null;
    saved_price_count := null;
    return next;
  end if;
end;
$$;

grant execute on function public.get_receipt_import_status(text)
to authenticated;

create or replace function public.save_receipt_price_batch_v2(
  p_supermarket text,
  p_date date,
  p_items jsonb,
  p_access_key text default null,
  p_original_line_count integer default null
)
returns table (
  saved_prices integer,
  created_products integer,
  reused_products integer,
  matched_by_barcode integer,
  matched_by_alias integer,
  matched_by_canonical integer,
  receipt_import_id uuid
)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := nullif(regexp_replace(coalesce(p_access_key, ''), '\D', '', 'g'), '');
  v_fingerprint text;
  v_existing public.receipt_imports%rowtype;
  v_import_id uuid;
  v_item jsonb;
  v_name text;
  v_price numeric;
  v_package_size numeric;
  v_package_unit text;
  v_normalized_price numeric;
  v_base_unit text;
  v_product_id uuid;
  v_created boolean;
  v_matched_by text;
  v_canonical_key text;
  v_existing_package_size numeric;
  v_existing_unit text;
  v_effective_package_size numeric;
  v_effective_unit text;
  v_saved integer := 0;
  v_created_count integer := 0;
  v_reused_count integer := 0;
  v_barcode_count integer := 0;
  v_alias_count integer := 0;
  v_canonical_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_date is null then
    raise exception 'Receipt date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Receipt items must be an array';
  end if;
  if v_key is not null and length(v_key) <> 44 then
    raise exception 'Invalid access key';
  end if;

  v_fingerprint := public.receipt_batch_fingerprint(p_supermarket, p_date, p_items);

  if v_key is not null then
    select r.* into v_existing
    from public.receipt_imports r
    where r.user_id = v_uid and r.access_key = v_key
    limit 1;

    if found then
      raise exception using
        errcode = 'P0001',
        message = 'RECEIPT_ALREADY_IMPORTED',
        detail = format(
          'Cupom já importado em %s (%s, %s).',
          to_char(v_existing.imported_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
          v_existing.supermarket,
          to_char(v_existing.receipt_date, 'DD/MM/YYYY')
        );
    end if;
  end if;

  select r.* into v_existing
  from public.receipt_imports r
  where r.user_id = v_uid
    and r.receipt_fingerprint = v_fingerprint
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'RECEIPT_ALREADY_IMPORTED',
      detail = format(
        'Este mesmo cupom já foi importado em %s (%s, %s).',
        to_char(v_existing.imported_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
        v_existing.supermarket,
        to_char(v_existing.receipt_date, 'DD/MM/YYYY')
      );
  end if;

  begin
    insert into public.receipt_imports (
      user_id, access_key, receipt_fingerprint, supermarket, receipt_date,
      source, original_line_count, saved_price_count
    )
    values (
      v_uid, v_key, v_fingerprint,
      coalesce(nullif(btrim(coalesce(p_supermarket, '')), ''), 'Não informado'),
      p_date, 'receipt', p_original_line_count, 0
    )
    returning id into v_import_id;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'RECEIPT_ALREADY_IMPORTED',
        detail = 'Este cupom já foi registrado anteriormente.';
  end;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_name := btrim(coalesce(v_item->>'name', ''));
    v_price := nullif(v_item->>'price', '')::numeric;
    if v_name = '' or v_price is null or v_price <= 0 then
      continue;
    end if;

    v_package_size := nullif(v_item->>'package_quantity', '')::numeric;
    v_package_unit := nullif(btrim(coalesce(v_item->>'package_unit', '')), '');
    v_normalized_price := nullif(v_item->>'normalized_price', '')::numeric;
    v_base_unit := nullif(btrim(coalesce(v_item->>'base_unit', '')), '');

    select r.product_id, r.created, r.matched_by, r.canonical_key
      into v_product_id, v_created, v_matched_by, v_canonical_key
    from public.resolve_or_create_product_identity(
      p_name => v_name,
      p_package_size => v_package_size,
      p_unit => v_package_unit,
      p_barcode => nullif(v_item->>'barcode', ''),
      p_retailer => nullif(btrim(coalesce(p_supermarket, '')), ''),
      p_source => 'receipt'
    ) r;

    if v_product_id is null then
      raise exception 'Could not resolve product identity for %', v_name;
    end if;

    select p.package_size, p.unit
      into v_existing_package_size, v_existing_unit
    from public.products p
    where p.id = v_product_id and p.user_id = v_uid;

    v_effective_package_size := coalesce(v_package_size, v_existing_package_size);
    v_effective_unit := coalesce(v_package_unit, v_existing_unit);

    if v_normalized_price is null
       and v_effective_package_size is not null
       and v_effective_package_size > 0
       and v_effective_unit is not null then
      case lower(v_effective_unit)
        when 'g' then
          v_normalized_price := v_price / (v_effective_package_size / 1000.0);
          v_base_unit := 'kg';
        when 'kg' then
          v_normalized_price := v_price / v_effective_package_size;
          v_base_unit := 'kg';
        when 'ml' then
          v_normalized_price := v_price / (v_effective_package_size / 1000.0);
          v_base_unit := 'l';
        when 'l' then
          v_normalized_price := v_price / v_effective_package_size;
          v_base_unit := 'l';
        when 'lt' then
          v_normalized_price := v_price / v_effective_package_size;
          v_base_unit := 'l';
        when 'un' then
          v_normalized_price := v_price / v_effective_package_size;
          v_base_unit := 'un';
        when 'und' then
          v_normalized_price := v_price / v_effective_package_size;
          v_base_unit := 'un';
        when 'unid' then
          v_normalized_price := v_price / v_effective_package_size;
          v_base_unit := 'un';
        else
          null;
      end case;
    end if;

    insert into public.prices (
      product_id, supermarket, price, date, user_id, source,
      package_quantity, package_unit, normalized_price, base_unit, receipt_text
    )
    values (
      v_product_id,
      coalesce(nullif(btrim(coalesce(p_supermarket, '')), ''), 'Não informado'),
      v_price, p_date, v_uid, 'receipt',
      v_effective_package_size, v_effective_unit,
      v_normalized_price, v_base_unit,
      nullif(v_item->>'receipt_text', '')
    );

    v_saved := v_saved + 1;
    if v_created then v_created_count := v_created_count + 1;
    else v_reused_count := v_reused_count + 1;
    end if;

    if v_matched_by = 'barcode' then v_barcode_count := v_barcode_count + 1;
    elsif v_matched_by like 'alias%' then v_alias_count := v_alias_count + 1;
    elsif v_matched_by = 'canonical' then v_canonical_count := v_canonical_count + 1;
    end if;
  end loop;

  update public.receipt_imports
  set saved_price_count = v_saved
  where id = v_import_id and user_id = v_uid;

  saved_prices := v_saved;
  created_products := v_created_count;
  reused_products := v_reused_count;
  matched_by_barcode := v_barcode_count;
  matched_by_alias := v_alias_count;
  matched_by_canonical := v_canonical_count;
  receipt_import_id := v_import_id;
  return next;
end;
$$;

grant execute on function public.save_receipt_price_batch_v2(
  text, date, jsonb, text, integer
) to authenticated;

commit;
