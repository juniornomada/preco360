create or replace function public.search_offer_items_v1(
  p_query text,
  p_on_date date default current_date,
  p_active_limit integer default 80,
  p_history_limit integer default 160
)
returns table(
  id uuid,
  flyer_id uuid,
  product_id uuid,
  raw_name text,
  normalized_name text,
  brand text,
  package_quantity numeric,
  package_unit text,
  advertised_price numeric,
  normalized_price numeric,
  base_unit text,
  club_price boolean,
  club_advertised_price numeric,
  source_page integer,
  image_url text,
  offer_notes text[],
  retailer text,
  valid_from date,
  valid_to date,
  is_active boolean
)
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_query text;
  v_tsquery tsquery;
  v_active_limit integer := greatest(1, least(coalesce(p_active_limit, 80), 120));
  v_history_limit integer := greatest(0, least(coalesce(p_history_limit, 160), 240));
  v_beef_search boolean := false;
  v_beef_pattern text :=
    '^(carne bovin[oa]s?|miolo do acem|acem|patinho|alcatra|maminha|paleta|bife de coxao (mole|duro)|coxao (mole|duro)|contra ?file|picanha|fraldinha|lagarto|cupim|costela bovin[oa]s?|costelao bovin[oa]s?|ponta de peito|peito bovino|capa de file|carne moida|file mignon|musculo|ossobuco|osso buco)( |$)';
  v_non_beef_pattern text :=
    '(^| )(suin[oa]s?|porcin[oa]s?|frango|ave|aves|peru)( |$)';
  v_processed_pattern text :=
    '(^| )(hamburguer|almondega|linguica|salsicha|bacon|lasanha|pizza|sanduiche|kibe)( |$)';
begin
  if v_uid is null then
    return;
  end if;

  v_query := regexp_replace(
    lower(trim(coalesce(p_query, ''))),
    '[^a-z0-9 ]+',
    ' ',
    'g'
  );
  v_query := trim(regexp_replace(v_query, '\s+', ' ', 'g'));

  v_beef_search := v_query in (
    'boi',
    'bovino',
    'bovina',
    'bovinos',
    'bovinas',
    'carne boi',
    'carne bovino',
    'carne bovina',
    'carne bovinos',
    'carne bovinas',
    'carnes bovinas',
    'carnes bovinos'
  );

  select to_tsquery(
    'simple',
    string_agg(token || ':*', ' & ' order by token)
  )
  into v_tsquery
  from (
    select distinct regexp_replace(part, '[^a-z0-9]+', '', 'g') as token
    from regexp_split_to_table(v_query, '\s+') as part
    where length(regexp_replace(part, '[^a-z0-9]+', '', 'g')) >= 2
  ) q;

  if v_tsquery is null and not v_beef_search then
    return;
  end if;

  return query
  with active_rows as (
    select
      fi.id,
      fi.flyer_id,
      fi.product_id,
      fi.raw_name,
      fi.normalized_name,
      fi.brand,
      fi.package_quantity,
      fi.package_unit,
      fi.advertised_price,
      fi.normalized_price,
      fi.base_unit,
      fi.club_price,
      fi.club_advertised_price,
      fi.source_page,
      fi.image_url,
      fi.offer_notes,
      f.retailer,
      f.valid_from,
      f.valid_to,
      true as is_active,
      case
        when v_beef_search then 1::real
        else ts_rank_cd(
          to_tsvector(
            'simple',
            coalesce(fi.normalized_name, '') || ' ' || coalesce(lower(fi.brand), '')
          ),
          v_tsquery
        )
      end as search_rank,
      fi.created_at
    from public.flyer_items fi
    join public.flyers f on f.id = fi.flyer_id
    where fi.user_id = v_uid
      and f.user_id = v_uid
      and f.valid_from <= p_on_date
      and f.valid_to >= p_on_date
      and (
        (
          v_beef_search
          and coalesce(fi.normalized_name, '') ~ v_beef_pattern
          and coalesce(fi.normalized_name, '') !~ v_non_beef_pattern
          and coalesce(fi.normalized_name, '') !~ v_processed_pattern
        )
        or (
          not v_beef_search
          and to_tsvector(
            'simple',
            coalesce(fi.normalized_name, '') || ' ' || coalesce(lower(fi.brand), '')
          ) @@ v_tsquery
        )
      )
    order by search_rank desc, fi.normalized_price asc nulls last, fi.created_at desc
    limit v_active_limit
  ),
  history_rows as (
    select
      fi.id,
      fi.flyer_id,
      fi.product_id,
      fi.raw_name,
      fi.normalized_name,
      fi.brand,
      fi.package_quantity,
      fi.package_unit,
      fi.advertised_price,
      fi.normalized_price,
      fi.base_unit,
      fi.club_price,
      fi.club_advertised_price,
      fi.source_page,
      null::text as image_url,
      fi.offer_notes,
      f.retailer,
      f.valid_from,
      f.valid_to,
      false as is_active,
      case
        when v_beef_search then 1::real
        else ts_rank_cd(
          to_tsvector(
            'simple',
            coalesce(fi.normalized_name, '') || ' ' || coalesce(lower(fi.brand), '')
          ),
          v_tsquery
        )
      end as search_rank,
      fi.created_at
    from public.flyer_items fi
    join public.flyers f on f.id = fi.flyer_id
    where v_history_limit > 0
      and fi.user_id = v_uid
      and f.user_id = v_uid
      and f.valid_to < p_on_date
      and (
        (
          v_beef_search
          and coalesce(fi.normalized_name, '') ~ v_beef_pattern
          and coalesce(fi.normalized_name, '') !~ v_non_beef_pattern
          and coalesce(fi.normalized_name, '') !~ v_processed_pattern
        )
        or (
          not v_beef_search
          and to_tsvector(
            'simple',
            coalesce(fi.normalized_name, '') || ' ' || coalesce(lower(fi.brand), '')
          ) @@ v_tsquery
        )
      )
    order by search_rank desc, fi.created_at desc
    limit v_history_limit
  )
  select
    a.id, a.flyer_id, a.product_id, a.raw_name, a.normalized_name, a.brand,
    a.package_quantity, a.package_unit, a.advertised_price, a.normalized_price,
    a.base_unit, a.club_price, a.club_advertised_price, a.source_page,
    a.image_url, a.offer_notes, a.retailer, a.valid_from, a.valid_to, a.is_active
  from active_rows a
  union all
  select
    h.id, h.flyer_id, h.product_id, h.raw_name, h.normalized_name, h.brand,
    h.package_quantity, h.package_unit, h.advertised_price, h.normalized_price,
    h.base_unit, h.club_price, h.club_advertised_price, h.source_page,
    h.image_url, h.offer_notes, h.retailer, h.valid_from, h.valid_to, h.is_active
  from history_rows h;
end;
$function$;
