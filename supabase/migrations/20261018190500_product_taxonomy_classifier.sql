-- Classification logic from anchored prioritized rules, never an identity key.
-- Uses owner-row RLS as supplied by existing products/flyer_items policies.
CREATE OR REPLACE FUNCTION public.classify_catalog_product_v1(raw_input text)
RETURNS TABLE(
  department text,
  category text,
  kind text,
  confidence text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $taxonomy$
  WITH prepared AS (
    SELECT btrim(regexp_replace(
      translate(
        lower(coalesce(raw_input,'')),
        'áàâãäåéèêëíìîïóòôõöúùûüçñ',
        'aaaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+',' ','g'
    )) AS normalized
  )
  SELECT r.department, r.category, r.kind, r.confidence
  FROM prepared n
  JOIN public.product_taxonomy_rules r
    ON n.normalized ~ r.pattern
  WHERE n.normalized <> ''
    AND (
      (n.normalized ~ '^batatas?\y' AND r.priority BETWEEN 1 AND 100)
      OR
      (n.normalized !~ '^batatas?\y' AND r.priority > 100)
    )
  ORDER BY r.priority
  LIMIT 1;
$taxonomy$;

CREATE OR REPLACE FUNCTION public.set_product_taxonomy_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=public,pg_catalog
AS $taxtrigger$
DECLARE
  classification record;
  old_auto_category text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_auto_category := OLD.taxonomy_category;
  END IF;
  SELECT * INTO classification FROM public.classify_catalog_product_v1(NEW.name);
  NEW.taxonomy_department := classification.department;
  NEW.taxonomy_category := classification.category;
  NEW.taxonomy_kind := classification.kind;
  NEW.taxonomy_confidence := classification.confidence;

  -- Never replace an explicit category the user entered.
  IF NEW.category = 'Geral' OR
     (old_auto_category IS NOT NULL AND NEW.category = old_auto_category)
  THEN
    NEW.category := CASE WHEN classification.confidence = 'high'
      THEN classification.category ELSE 'Geral' END;
  END IF;
  RETURN NEW;
END;
$taxtrigger$;

CREATE OR REPLACE FUNCTION public.set_flyer_taxonomy_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=public,pg_catalog
AS $flyertrigger$
DECLARE
  classification record;
BEGIN
  SELECT * INTO classification FROM public.classify_catalog_product_v1(NEW.raw_name);
  NEW.taxonomy_department := classification.department;
  NEW.taxonomy_category := classification.category;
  NEW.taxonomy_kind := classification.kind;
  NEW.taxonomy_confidence := classification.confidence;
  RETURN NEW;
END;
$flyertrigger$;

DROP TRIGGER IF EXISTS product_taxonomy_fill_v1 ON public.products;
CREATE TRIGGER product_taxonomy_fill_v1
BEFORE INSERT OR UPDATE OF name ON public.products
FOR EACH ROW EXECUTE FUNCTION public.set_product_taxonomy_v1();

DROP TRIGGER IF EXISTS flyer_taxonomy_fill_v1 ON public.flyer_items;
CREATE TRIGGER flyer_taxonomy_fill_v1
BEFORE INSERT OR UPDATE OF raw_name ON public.flyer_items
FOR EACH ROW EXECUTE FUNCTION public.set_flyer_taxonomy_v1();
