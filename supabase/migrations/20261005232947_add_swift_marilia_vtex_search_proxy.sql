create or replace function public.swift_marilia_vtex_search_page_v1(p_page integer)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_url text;
  v_status integer;
  v_content text;
begin
  if p_page < 1 or p_page > 4 then
    raise exception 'INVALID_PAGE';
  end if;

  v_url :=
    'https://loja.swift.com.br/api/intelligent-search/v1/product-search/trade-policy/1'
    || '?page=' || p_page::text
    || '&count=50'
    || '&sort=discount%3Adesc'
    || '&locale=pt-BR'
    || '&sc=1'
    || '&country=BRA'
    || '&regionId=v2.4E371F02AE6D14D7AC7E1C6FAE5BED3E'
    || '&zip-code=17519000';

  select (r).status, (r).content
    into v_status, v_content
  from (select extensions.http_get(v_url) as r) s;

  if v_status <> 200 then
    raise exception 'SWIFT_VTEX_HTTP_%', v_status;
  end if;

  return v_content::jsonb;
end;
$$;

revoke all on function public.swift_marilia_vtex_search_page_v1(integer) from public;
revoke all on function public.swift_marilia_vtex_search_page_v1(integer) from anon;
revoke all on function public.swift_marilia_vtex_search_page_v1(integer) from authenticated;
grant execute on function public.swift_marilia_vtex_search_page_v1(integer) to service_role;
