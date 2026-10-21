begin;

-- Central package resolver used by the receipt write path. It prefers explicit
-- physical dimensions, then a small set of high-confidence fiscal
-- abbreviations, and finally the receipt sale unit as an honest R$/un fallback.
create or replace function public.infer_receipt_package_v1(
  p_name text,
  p_sale_unit text default null
)
returns table (
  package_size numeric,
  unit text,
  source text,
  confidence text
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v text := lower(unaccent(btrim(coalesce(p_name, ''))));
  v_sale text := upper(btrim(coalesce(p_sale_unit, '')));
  v_capacity boolean;
  m text[];
  q numeric;
  n numeric;
  each_q numeric;
  u text;
begin
  v := regexp_replace(v, '\s+', ' ', 'g');
  if v = '' then return; end if;

  v_capacity :=
    v ~ '^(sc|saco)\s+lixo(\s|$)'
    or v ~ '^(caixa\s+(organizadora|termica)|garrafa\s+termica|lixeira|balde|panela|frigideira|jarra|mop)(\s|$)';

  if not v_capacity then
    -- Owner-verified recurring fiscal abbreviation for the 600 g in-natura tray.
    if v ~ '^milho\s+(vd|verde).*fern.*bd[ .]?00g\s*$' then
      return query select 600::numeric, 'g'::text, 'verified-rule'::text, 'high'::text;
      return;
    end if;

    -- Explicit multipack: 6x500ml, 3x200g, etc.
    m := regexp_match(
      v,
      '([0-9]{1,2})\s*x\s*([0-9]+([,.][0-9]+)?)\s*(kg|g|ml|l|lt)([^a-z]|$)',
      'i'
    );
    if m is not null then
      n := m[1]::numeric;
      each_q := replace(m[2], ',', '.')::numeric;
      u := lower(m[4]);
      if u = 'lt' then u := 'l'; end if;
      q := n * each_q;
      if q > 0 then
        return query select q, u, 'explicit-name'::text, 'high'::text;
        return;
      end if;
    end if;

    -- Explicit physical/unit package: 500g, 1kg, 900ml, 2L, 4un.
    m := regexp_match(
      v,
      '([0-9]+([,.][0-9]+)?)\s*(kg|quilo|quilos|g|grama|gramas|ml|l|lt|litro|litros|un|und|unid|unidade|unidades)([^a-z]|$)',
      'i'
    );
    if m is not null then
      q := replace(m[1], ',', '.')::numeric;
      u := lower(m[3]);
      if u in ('quilo','quilos') then u := 'kg'; end if;
      if u in ('grama','gramas') then u := 'g'; end if;
      if u in ('lt','litro','litros') then u := 'l'; end if;
      if u in ('und','unid','unidade','unidades') then u := 'un'; end if;
      if q > 0 then
        return query select q, u, 'explicit-name'::text, 'high'::text;
        return;
      end if;
    end if;

    -- Fiscal names such as "COXAO DURO BOV.kg" or "ABACAXI UN".
    if v ~ '(^|[^a-z])kg([^a-z]|$)' then
      return query select 1::numeric, 'kg'::text, 'explicit-name'::text, 'high'::text;
      return;
    end if;
    if v ~ '(^|[^a-z])(un|und|unid|unidade|unidades)([^a-z]|$)' then
      return query select 1::numeric, 'un'::text, 'explicit-name'::text, 'high'::text;
      return;
    end if;
  end if;

  -- Owner-verified package that was previously a UI-only exception.
  if v ~ '^massa\s+(p\s*/\s*|para\s+|de\s+)?pastel\s+da\s+feira$' then
    return query select 1::numeric, 'kg'::text, 'verified-rule'::text, 'high'::text;
    return;
  end if;

  -- Compact receipt abbreviation: 1,25k => 1,25kg. Requiring a decimal
  -- prevents model codes such as "2680 K" from being treated as kilograms.
  m := regexp_match(v, '(^|\s)([0-9]{1,2}[,.][0-9]{1,3})k\s*$');
  if m is not null then
    q := replace(m[2], ',', '.')::numeric;
    if q > 0 and q <= 20 then
      return query select q, 'kg'::text, 'family-suffix'::text, 'high'::text;
      return;
    end if;
  end if;

  -- Fermented milk multipacks often arrive as "6X80" with no "ml".
  m := regexp_match(v, '([0-9]{1,2})\s*x\s*([0-9]{2,4})\s*$');
  if m is not null and v ~ '(leite\s+ferm|yakult)' then
    n := m[1]::numeric;
    each_q := m[2]::numeric;
    if n between 2 and 24 and each_q between 40 and 500 then
      return query select n * each_q, 'ml'::text, 'family-suffix'::text, 'high'::text;
      return;
    end if;
  end if;

  -- Bare trailing number is only interpreted inside product families whose
  -- physical dimension is unambiguous. Never treat COD/SKU/REF/LOTE as size.
  if v !~ '(cod|codigo|ref|sku|lote)\s*[.:#-]?\s*[0-9]+\s*$' then
    m := regexp_match(v, '([0-9]{1,5}([,.][0-9]{1,3})?)\s*$');
    if m is not null then
      q := replace(m[1], ',', '.')::numeric;

      if v ~ '(amido(\s+de)?\s+milho|bisc(uito)?|bolacha|cafe\s+sol|leite\s+cond|manteiga|(^|\s)mant\s|margarina|farinha|(^|\s)far\s|fermento|(^|\s)ferm\s|milho\s+pip|pipoca|pao\s+forma|pao\s+de\s+forma|bombom|cereal|farofa|goiabada|quiabo.*(band|bd))'
         and q between 10 and 5000 then
        return query select q, 'g'::text, 'family-suffix'::text, 'high'::text;
        return;
      end if;

      if v ~ '^oleo(\s+de)?\s+soja' and q between 100 and 5000 then
        return query select q, 'ml'::text, 'family-suffix'::text, 'high'::text;
        return;
      end if;

      if v ~ '(desinf(etante)?|agua\s+sanitaria|lava\s+louca|detergente|amaciante|refrigerante|refri|suco|leite\s+liq|iog\s+liq|molho)' then
        if q between 50 and 10000 then
          return query select q, 'ml'::text, 'family-suffix'::text, 'high'::text;
          return;
        elsif q between 1 and 20 then
          return query select q, 'l'::text, 'family-suffix'::text, 'high'::text;
          return;
        end if;
      end if;
    end if;
  end if;

  -- Sale-unit fallback. This keeps future receipt imports comparable even
  -- when the physical package is absent from the fiscal description.
  if v_sale = 'KG' then
    return query select 1::numeric, 'kg'::text, 'sale-unit'::text, 'high'::text;
    return;
  elsif v_sale = 'G' then
    return query select 1::numeric, 'g'::text, 'sale-unit'::text, 'high'::text;
    return;
  elsif v_sale in ('L','LT') then
    return query select 1::numeric, 'l'::text, 'sale-unit'::text, 'high'::text;
    return;
  elsif v_sale = 'ML' then
    return query select 1::numeric, 'ml'::text, 'sale-unit'::text, 'high'::text;
    return;
  elsif v_sale in ('UN','UND','UNID','PC','PÇ','PCT','PT','CX','FD','FR','BD','RL','DZ','JG','KIT') then
    return query select 1::numeric, 'un'::text, 'sale-unit'::text, 'fallback'::text;
    return;
  end if;

  return;
end;
$$;

create or replace function public.product_name_with_package_v1(
  p_name text,
  p_package_size numeric,
  p_unit text
)
returns text
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v text := lower(unaccent(btrim(coalesce(p_name, ''))));
  u text := lower(btrim(coalesce(p_unit, '')));
  unit_label text;
  size_label text;
  m text[];
  trailing_q numeric;
begin
  if v_name = '' or p_package_size is null or p_package_size <= 0 then return v_name; end if;
  if u = 'lt' then u := 'l'; end if;
  if u not in ('g','kg','ml','l') then return v_name; end if;

  unit_label := case when u = 'l' then 'L' else u end;
  size_label := replace(trim(to_char(p_package_size, 'FM999999990.###')), '.', ',');

  if u = 'g' and p_package_size = 600
     and v ~ '^milho\s+(vd|verde).*fern.*bd[ .]?00g\s*$' then
    return regexp_replace(v_name, '00g\s*$', '600g', 'i');
  end if;

  if u = 'kg' and v ~ '[0-9]{1,2}[,.][0-9]{1,3}k\s*$' then
    return regexp_replace(v_name, 'k\s*$', 'kg', 'i');
  end if;

  -- Already has an explicit physical unit.
  if v ~ '[0-9]+([,.][0-9]+)?\s*(kg|g|ml|l|lt|litro|litros|quilo|quilos|grama|gramas)([^a-z]|$)'
     or v ~ '(^|[^a-z])kg([^a-z]|$)' then
    return v_name;
  end if;

  m := regexp_match(v, '([0-9]{1,5}([,.][0-9]{1,3})?)\s*$');
  if m is not null then
    trailing_q := replace(m[1], ',', '.')::numeric;
    if abs(trailing_q - p_package_size) < 0.0001 then
      return rtrim(v_name) || unit_label;
    end if;
  end if;

  -- 6X80 + resolved 480ml => 6X80ml.
  m := regexp_match(v, '([0-9]{1,2})\s*x\s*([0-9]{2,4})\s*$');
  if m is not null and abs((m[1]::numeric * m[2]::numeric) - p_package_size) < 0.0001 then
    return rtrim(v_name) || unit_label;
  end if;

  return v_name || ' ' || size_label || unit_label;
end;
$$;

revoke all on function public.infer_receipt_package_v1(text,text) from public;
grant execute on function public.infer_receipt_package_v1(text,text) to authenticated;

revoke all on function public.product_name_with_package_v1(text,numeric,text) from public;
grant execute on function public.product_name_with_package_v1(text,numeric,text) to authenticated;

-- Preserve the original fiscal spelling as an alias before enriching names.
insert into public.product_aliases (
  user_id, product_id, alias, normalized_alias, retailer,
  package_size, unit, barcode, source, seen_count, last_seen_at
)
select
  p.user_id, p.id, p.name, public.normalize_product_alias(p.name), null,
  p.package_size, p.unit, nullif(btrim(p.barcode), ''), 'package-backfill', 1, now()
from public.products p
where p.package_size is null or p.unit is null or btrim(coalesce(p.unit,'')) = ''
on conflict (user_id, normalized_alias, (coalesce(retailer, ''::text))) do nothing;

-- Backfill existing products. Priority:
-- 1) name/receipt evidence through the central resolver;
-- 2) a single unambiguous linked flyer package.
with flyer_unique as (
  select
    f.product_id,
    min(f.package_quantity) as package_size,
    min(lower(f.package_unit)) as unit
  from public.flyer_items f
  where f.package_quantity is not null
    and f.package_quantity > 0
    and lower(btrim(coalesce(f.package_unit,''))) in ('g','kg','ml','l','lt','un','und','unid')
  group by f.product_id
  having count(distinct concat(f.package_quantity, '|', lower(f.package_unit))) = 1
),
candidates as (
  select
    p.id,
    p.name as old_name,
    coalesce(ir.package_size, fu.package_size) as package_size,
    coalesce(ir.unit, fu.unit) as unit
  from public.products p
  left join lateral (
    select (regexp_match(coalesce(pr.receipt_text,''), '/([A-Za-zÇç]+)(?:\s|\||$)'))[1] as sale_unit
    from public.prices pr
    where pr.product_id = p.id
      and pr.source = 'receipt'
      and pr.receipt_text is not null
      and pr.receipt_text ~ '/[A-Za-zÇç]+'
    order by pr.date desc, pr.created_at desc
    limit 1
  ) su on true
  left join lateral public.infer_receipt_package_v1(p.name, su.sale_unit) ir on true
  left join flyer_unique fu on fu.product_id = p.id
  where p.package_size is null or p.unit is null or btrim(coalesce(p.unit,'')) = ''
),
resolved as (
  select *
  from candidates
  where package_size is not null
    and package_size > 0
    and unit is not null
    and btrim(unit) <> ''
)
update public.products p
set
  package_size = r.package_size,
  unit = case lower(r.unit) when 'lt' then 'l' when 'und' then 'un' when 'unid' then 'un' else lower(r.unit) end,
  name = case
    when lower(r.unit) in ('g','kg','ml','l','lt')
      then public.product_name_with_package_v1(p.name, r.package_size, r.unit)
    else p.name
  end,
  canonical_key = public.product_canonical_key(
    case
      when lower(r.unit) in ('g','kg','ml','l','lt')
        then public.product_name_with_package_v1(p.name, r.package_size, r.unit)
      else p.name
    end,
    r.package_size,
    case lower(r.unit) when 'lt' then 'l' when 'und' then 'un' when 'unid' then 'un' else lower(r.unit) end
  ),
  updated_at = now()
from resolved r
where p.id = r.id;

-- Keep aliases aligned with newly resolved product metadata.
update public.product_aliases a
set
  package_size = coalesce(a.package_size, p.package_size),
  unit = coalesce(a.unit, p.unit)
from public.products p
where a.product_id = p.id
  and p.package_size is not null
  and p.unit is not null
  and (a.package_size is null or a.unit is null);

-- Rebuild comparable receipt history from resolved product metadata.
update public.prices pr
set
  package_quantity = coalesce(pr.package_quantity, p.package_size),
  package_unit = coalesce(pr.package_unit, p.unit),
  normalized_price = case
    when lower(p.unit) = 'g' then pr.price / (p.package_size / 1000.0)
    when lower(p.unit) = 'kg' then pr.price / p.package_size
    when lower(p.unit) = 'ml' then pr.price / (p.package_size / 1000.0)
    when lower(p.unit) in ('l','lt') then pr.price / p.package_size
    when lower(p.unit) in ('un','und','unid') then pr.price / p.package_size
    else pr.normalized_price
  end,
  base_unit = case
    when lower(p.unit) in ('g','kg') then 'kg'
    when lower(p.unit) in ('ml','l','lt') then 'l'
    when lower(p.unit) in ('un','und','unid') then 'un'
    else pr.base_unit
  end
from public.products p
where pr.product_id = p.id
  and pr.source = 'receipt'
  and pr.price > 0
  and p.package_size is not null
  and p.package_size > 0
  and p.unit is not null
  and lower(p.unit) in ('g','kg','ml','l','lt','un','und','unid');

-- Centralized receipt writer. Every channel (QR, access key, image/PDF/HTML)
-- calls this RPC, so backend inference protects future imports even if a
-- client fails to send package metadata.
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
  v_sale_unit text;
  v_package_size numeric;
  v_package_unit text;
  v_inferred_source text;
  v_inferred_confidence text;
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
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_date is null then raise exception 'Receipt date is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Receipt items must be an array';
  end if;
  if v_key is not null and length(v_key) <> 44 then raise exception 'Invalid access key'; end if;

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
  where r.user_id = v_uid and r.receipt_fingerprint = v_fingerprint
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
  exception when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'RECEIPT_ALREADY_IMPORTED',
      detail = 'Este cupom já foi registrado anteriormente.';
  end;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_name := btrim(coalesce(v_item->>'name', ''));
    v_price := nullif(v_item->>'price', '')::numeric;
    if v_name = '' or v_price is null or v_price <= 0 then continue; end if;

    v_sale_unit := nullif(upper(btrim(coalesce(v_item->>'sale_unit', ''))), '');
    v_package_size := nullif(v_item->>'package_quantity', '')::numeric;
    v_package_unit := nullif(lower(btrim(coalesce(v_item->>'package_unit', ''))), '');
    v_normalized_price := nullif(v_item->>'normalized_price', '')::numeric;
    v_base_unit := nullif(lower(btrim(coalesce(v_item->>'base_unit', ''))), '');
    v_inferred_source := null;
    v_inferred_confidence := null;

    if v_package_size is null or v_package_unit is null then
      select i.package_size, i.unit, i.source, i.confidence
        into v_package_size, v_package_unit, v_inferred_source, v_inferred_confidence
      from public.infer_receipt_package_v1(v_name, v_sale_unit) i
      limit 1;
    end if;

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

    -- Upgrade a prior R$/un fallback when stronger physical metadata arrives.
    if v_package_size is not null
       and v_package_unit is not null
       and lower(v_package_unit) in ('g','kg','ml','l','lt') then
      update public.products p
      set
        package_size = v_package_size,
        unit = case when lower(v_package_unit) = 'lt' then 'l' else lower(v_package_unit) end,
        name = case
          when p.name = v_name
            then public.product_name_with_package_v1(p.name, v_package_size, v_package_unit)
          else p.name
        end,
        canonical_key = public.product_canonical_key(
          case
            when p.name = v_name
              then public.product_name_with_package_v1(p.name, v_package_size, v_package_unit)
            else p.name
          end,
          v_package_size,
          case when lower(v_package_unit) = 'lt' then 'l' else lower(v_package_unit) end
        ),
        updated_at = now()
      where p.id = v_product_id
        and p.user_id = v_uid
        and (
          p.package_size is null
          or p.unit is null
          or lower(p.unit) in ('un','und','unid')
        );
    end if;

    select p.package_size, p.unit
      into v_existing_package_size, v_existing_unit
    from public.products p
    where p.id = v_product_id and p.user_id = v_uid;

    if v_existing_package_size is not null
       and v_existing_unit is not null
       and lower(v_existing_unit) in ('g','kg','ml','l','lt')
       and (v_package_unit is null or lower(v_package_unit) in ('un','und','unid')) then
      v_effective_package_size := v_existing_package_size;
      v_effective_unit := v_existing_unit;
    else
      v_effective_package_size := coalesce(v_package_size, v_existing_package_size);
      v_effective_unit := coalesce(v_package_unit, v_existing_unit);
    end if;

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
        else null;
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

revoke all on function public.save_receipt_price_batch_v2(text,date,jsonb,text,integer) from public;
grant execute on function public.save_receipt_price_batch_v2(text,date,jsonb,text,integer) to authenticated;

commit;
