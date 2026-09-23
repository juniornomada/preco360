-- Canonicalize retailer names that refer to the same supermarket chain.
-- Keep one spelling in flyers, import jobs and aliases so Radar/Cesta do not
-- treat the same market as two separate retailers.

-- Remove alias duplicates that would collide after retailer normalization.
delete from public.product_aliases old_alias
using public.product_aliases canonical_alias
where old_alias.user_id = canonical_alias.user_id
  and old_alias.normalized_alias = canonical_alias.normalized_alias
  and old_alias.product_id = canonical_alias.product_id
  and (
    (old_alias.retailer = 'Supermercados Kawakami' and canonical_alias.retailer = 'Kawakami')
    or
    (old_alias.retailer = 'Confiança Supermercados' and canonical_alias.retailer = 'Confiança')
  );

update public.product_aliases
set retailer = case
  when retailer = 'Supermercados Kawakami' then 'Kawakami'
  when retailer = 'Confiança Supermercados' then 'Confiança'
  else retailer
end
where retailer in ('Supermercados Kawakami', 'Confiança Supermercados');

update public.flyers
set
  retailer = case
    when retailer = 'Supermercados Kawakami' then 'Kawakami'
    when retailer = 'Confiança Supermercados' then 'Confiança'
    else retailer
  end,
  title = case
    when retailer = 'Supermercados Kawakami'
      then regexp_replace(coalesce(title, ''), '^Supermercados Kawakami', 'Kawakami')
    when retailer = 'Confiança Supermercados'
      then regexp_replace(coalesce(title, ''), '^Confiança Supermercados', 'Confiança')
    else title
  end
where retailer in ('Supermercados Kawakami', 'Confiança Supermercados');

update public.flyer_import_jobs
set
  retailer = case
    when retailer = 'Supermercados Kawakami' then 'Kawakami'
    when retailer = 'Confiança Supermercados' then 'Confiança'
    else retailer
  end,
  result = case
    when result is null then null
    when coalesce(result->>'retailer', '') = 'Supermercados Kawakami'
      then jsonb_set(result, '{retailer}', to_jsonb('Kawakami'::text), true)
    when coalesce(result->>'retailer', '') = 'Confiança Supermercados'
      then jsonb_set(result, '{retailer}', to_jsonb('Confiança'::text), true)
    else result
  end
where retailer in ('Supermercados Kawakami', 'Confiança Supermercados')
   or coalesce(result->>'retailer', '') in ('Supermercados Kawakami', 'Confiança Supermercados');
