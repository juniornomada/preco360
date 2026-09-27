CREATE OR REPLACE FUNCTION public.offer_images_audit_page_v3(p_on_date date DEFAULT CURRENT_DATE, p_query text DEFAULT ''::text, p_only_missing boolean DEFAULT false, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(items jsonb, total_count bigint, missing_count bigint, horti_count bigint, filtered_count bigint, flyer_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with active_flyers as (
    select f.id, f.retailer, f.valid_to
    from public.flyers f
    where f.user_id = (select auth.uid())
      and f.valid_from <= p_on_date and f.valid_to >= p_on_date
  ),
  all_active as (
    select
      fi.id, fi.flyer_id, fi.raw_name, fi.normalized_name, fi.brand,
      fi.package_quantity, fi.package_unit, fi.advertised_price,
      fi.club_advertised_price, fi.offer_notes, fi.image_url,
      fi.image_source, fi.image_match_status, fi.created_at as item_created,
      af.retailer, af.valid_to,
      lower(regexp_replace(coalesce(nullif(fi.normalized_name, ''), fi.raw_name, ''), '[^[:alnum:]]', '', 'g')) as name_key,
      lower(regexp_replace(coalesce(fi.brand, ''), '[^[:alnum:]]', '', 'g')) as brand_key,
      lower(regexp_replace(coalesce(af.retailer, ''), '[^[:alnum:]]', '', 'g')) as retailer_key,
      coalesce((
        select string_agg(regexp_replace(trim(u.note), '[[:space:]]+', ' ', 'g'), ' | ' order by u.note)
        from unnest(coalesce(fi.offer_notes, '{}'::text[])) as u(note)
        where u.note ~* '[0-9]{3}[[:space:]]*/[[:space:]]*[0-9]{2}[[:space:]]*R[[:space:]]*[0-9]{2}'
      ), '') as variant_key,
      case
        when fi.club_advertised_price > 0
          and (fi.advertised_price is null or fi.club_advertised_price <= fi.advertised_price)
          and not exists (
            select 1 from unnest(coalesce(fi.offer_notes, '{}'::text[])) as u(note)
            where u.note ~* '(cart[aã]o.{0,50}(muffato|credifatto)|(?:muffato|credifatto).{0,50}cart[aã]o|cart[aã]o[[:space:]]+elo|com[[:space:]]+elo|pre[cç]o exclusivo com credifatto)'
          )
        then fi.club_advertised_price
        else fi.advertised_price
      end as effective_price,
      lower(coalesce(fi.normalized_name, '') || ' ' || coalesce(fi.brand, '') || ' ' || coalesce(af.retailer, '')) as search_text
    from public.flyer_items fi
    join active_flyers af on af.id = fi.flyer_id
    where fi.user_id = (select auth.uid())
  ),
  ranked as (
    select
      a.*,
      count(*) over product_group as group_count,
      bool_or(a.image_url is not null) over product_group as group_has_image,
      bool_and(a.image_url is null and coalesce(a.image_source, '') = 'horti_skip') over product_group as group_is_horti,
      min(a.effective_price) over product_group as best_price,
      row_number() over (
        product_group
        order by (a.image_url is not null) desc, a.effective_price asc nulls last, a.valid_to desc, a.item_created desc, a.id
      ) as group_row
    from all_active a
    window product_group as (
      partition by a.retailer_key, a.name_key, a.brand_key, a.package_quantity,
        lower(coalesce(a.package_unit, '')), a.variant_key
    )
  ),
  products as (
    select r.*, coalesce(r.best_price, r.advertised_price) as display_price
    from ranked r where r.group_row = 1
  ),
  filtered as (
    select p.* from products p
    where (not p_only_missing or (not p.group_has_image and not p.group_is_horti))
      and (
        nullif(trim(p_query), '') is null
        or not exists (
          select 1
          from regexp_split_to_table(lower(trim(p_query)), '[[:space:]]+') as t(token)
          where t.token <> '' and p.search_text not like '%' || t.token || '%'
        )
      )
  ),
  page as (
    select * from filtered order by raw_name asc, id asc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
    offset greatest(0, coalesce(p_offset, 0))
  ),
  stats as (
    select
      (select count(*) from products)::bigint as total_count,
      (select count(*) from products where not group_has_image and not group_is_horti)::bigint as missing_count,
      (select count(*) from products where group_is_horti)::bigint as horti_count,
      (select count(*) from filtered)::bigint as filtered_count,
      (select count(*) from active_flyers)::bigint as flyer_count
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'flyer_id', p.flyer_id, 'raw_name', p.raw_name,
        'brand', p.brand, 'package_quantity', p.package_quantity,
        'package_unit', p.package_unit, 'advertised_price', p.display_price,
        'image_url', p.image_url, 'image_source', p.image_source,
        'image_match_status', p.image_match_status, 'retailer', p.retailer,
        'valid_to', p.valid_to
      ) order by p.raw_name asc, p.id asc)
      from page p
    ), '[]'::jsonb) as items,
    s.total_count, s.missing_count, s.horti_count, s.filtered_count, s.flyer_count
  from stats s;
$function$


revoke all on function public.offer_images_audit_page_v3(date, text, boolean, integer, integer) from public;
grant execute on function public.offer_images_audit_page_v3(date, text, boolean, integer, integer) to authenticated;
