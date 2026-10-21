begin;

-- Follow-up hardening for legacy fiscal abbreviations that were not fully
-- represented in old receipt_text rows.
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
  v_parse text;
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

  -- Fiscal abbreviations may glue a physical unit to the last token:
  -- "BOV.RESFkg", "SABOR500ml", etc.
  v_parse := regexp_replace(v, '([a-z]{3,})(kg|ml)\s*$', '\1 \2', 'i');

  v_capacity :=
    v_parse ~ '^(sc|saco)\s+lixo(\s|$)'
    or v_parse ~ '^(caixa\s+(organizadora|termica)|garrafa\s+termica|lixeira|balde|panela|frigideira|jarra|mop)(\s|$)';

  if not v_capacity then
    if v_parse ~ '^milho\s+(vd|verde).*fern.*bd[ .]?00g\s*$' then
      return query select 600::numeric, 'g'::text, 'verified-rule'::text, 'high'::text;
      return;
    end if;

    m := regexp_match(
      v_parse,
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

    m := regexp_match(
      v_parse,
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

    if v_parse ~ '(^|[^a-z])kg([^a-z]|$)' then
      return query select 1::numeric, 'kg'::text, 'explicit-name'::text, 'high'::text;
      return;
    end if;
    if v_parse ~ '(^|[^a-z])(un|und|unid|unidade|unidades)([^a-z]|$)' then
      return query select 1::numeric, 'un'::text, 'explicit-name'::text, 'high'::text;
      return;
    end if;
  end if;

  if v_parse ~ '^massa\s+(p\s*/\s*|para\s+|de\s+)?pastel\s+da\s+feira$' then
    return query select 1::numeric, 'kg'::text, 'verified-rule'::text, 'high'::text;
    return;
  end if;

  m := regexp_match(v_parse, '(^|\s)([0-9]{1,2}[,.][0-9]{1,3})k\s*$');
  if m is not null then
    q := replace(m[2], ',', '.')::numeric;
    if q > 0 and q <= 20 then
      return query select q, 'kg'::text, 'family-suffix'::text, 'high'::text;
      return;
    end if;
  end if;

  m := regexp_match(v_parse, '([0-9]{1,2})\s*x\s*([0-9]{2,4})\s*$');
  if m is not null and v_parse ~ '(leite\s+ferm|yakult)' then
    n := m[1]::numeric;
    each_q := m[2]::numeric;
    if n between 2 and 24 and each_q between 40 and 500 then
      return query select n * each_q, 'ml'::text, 'family-suffix'::text, 'high'::text;
      return;
    end if;
  end if;

  if v_parse !~ '(cod|codigo|ref|sku|lote)\s*[.:#-]?\s*[0-9]+\s*$' then
    -- Also allow a package/container abbreviation after the size:
    -- "MANT AVIACAO 500 PT" => 500 g.
    m := regexp_match(
      v_parse,
      '([0-9]{1,5}([,.][0-9]{1,3})?)(\s+(pt|pote|pct|pacote|pc|bd|band|cx|caixa))?\s*$'
    );
    if m is not null then
      q := replace(m[1], ',', '.')::numeric;

      if v_parse ~ '(amido(\s+de)?\s+milho|bisc(uito)?|bolacha|cafe\s+sol|leite\s+cond|manteiga|(^|\s)mant\s|margarina|farinha|(^|\s)far\s|fermento|(^|\s)ferm\s|milho\s+pip|pipoca|pao\s+forma|pao\s+de\s+forma|bombom|cereal|farofa|goiabada|quiabo.*(band|bd))'
         and q between 10 and 5000 then
        return query select q, 'g'::text, 'family-suffix'::text, 'high'::text;
        return;
      end if;

      if v_parse ~ '^oleo(\s+de)?\s+soja' and q between 100 and 5000 then
        return query select q, 'ml'::text, 'family-suffix'::text, 'high'::text;
        return;
      end if;

      if v_parse ~ '(desinf(etante)?|agua\s+sanitaria|lava\s+louca|detergente|amaciante|refrigerante|refri|suco|leite\s+liq|iog\s+liq|molho)' then
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

  -- Legacy receipts sometimes retained neither package size nor sale unit.
  -- For clearly pre-packed families, R$/un is safer and more useful than
  -- fabricating grams/litres. A future receipt with physical metadata upgrades
  -- this fallback because the writer replaces existing "un" metadata.
  if v_parse ~ '(^|\s)(bisc|cr\s+d\s+colgate|elast|filme\s+pvc|iog|leite\s+f|kit\s+meia|papel\s+alum|ref\s|refrig|saco\s+p[ /]?alim|svt|sorvete)(\s|\.|$)' then
    return query select 1::numeric, 'un'::text, 'packaged-family-fallback'::text, 'fallback'::text;
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

  -- Improve readability of a glued terminal unit without changing meaning.
  if u = 'kg' and v ~ '[a-z]{3,}kg\s*$' then
    return regexp_replace(v_name, '([[:alpha:]]{3,})kg\s*$', '\1 kg', 'i');
  end if;
  if u = 'ml' and v ~ '[a-z]{3,}ml\s*$' then
    return regexp_replace(v_name, '([[:alpha:]]{3,})ml\s*$', '\1 ml', 'i');
  end if;

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

  m := regexp_match(v, '([0-9]{1,5}([,.][0-9]{1,3})?)\s+(pt|pote|pct|pacote|pc|bd|band|cx|caixa)\s*$');
  if m is not null then
    trailing_q := replace(m[1], ',', '.')::numeric;
    if abs(trailing_q - p_package_size) < 0.0001 then
      return regexp_replace(
        v_name,
        '([0-9]{1,5}([,.][0-9]{1,3})?)\s+(PT|POTE|PCT|PACOTE|PC|BD|BAND|CX|CAIXA)\s*$',
        '\1' || unit_label || ' \3',
        'i'
      );
    end if;
  end if;

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

-- Preserve old names as aliases before changing the remaining legacy rows.
insert into public.product_aliases (
  user_id, product_id, alias, normalized_alias, retailer,
  package_size, unit, barcode, source, seen_count, last_seen_at
)
select
  p.user_id, p.id, p.name, public.normalize_product_alias(p.name), null,
  p.package_size, p.unit, nullif(btrim(p.barcode), ''), 'package-backfill-v2', 1, now()
from public.products p
where p.package_size is null or p.unit is null or btrim(coalesce(p.unit,'')) = ''
on conflict (user_id, normalized_alias, (coalesce(retailer, ''::text))) do nothing;

with candidates as (
  select
    p.id,
    ir.package_size,
    ir.unit
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

update public.product_aliases a
set
  package_size = coalesce(a.package_size, p.package_size),
  unit = coalesce(a.unit, p.unit)
from public.products p
where a.product_id = p.id
  and p.package_size is not null
  and p.unit is not null
  and (a.package_size is null or a.unit is null);

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
  and lower(p.unit) in ('g','kg','ml','l','lt','un','und','unid')
  and (
    pr.package_quantity is null
    or pr.package_unit is null
    or pr.normalized_price is null
    or pr.base_unit is null
  );

commit;
