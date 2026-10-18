-- Flyer taxonomy partition 3/4 (idempotent).
-- Runs after all taxonomy rules and triggers are available.
-- No price, raw name, owner or product matching key is modified.
-- Separate migrations bound the duration of each write transaction.
WITH suggestions AS (
  SELECT f.id, c.department, c.category AS suggested_category,
    c.kind, c.confidence
  FROM public.flyer_items AS f
  LEFT JOIN LATERAL public.classify_catalog_product_v1(f.raw_name) AS c ON true
  WHERE (hashtext(f.id::text)::bigint & 2147483647) % 4 = 2
)
UPDATE public.flyer_items AS f
SET taxonomy_department = s.department,
    taxonomy_category = s.suggested_category,
    taxonomy_kind = s.kind,
    taxonomy_confidence = s.confidence
FROM suggestions AS s
WHERE f.id = s.id
  AND (
    f.taxonomy_department, f.taxonomy_category,
    f.taxonomy_kind, f.taxonomy_confidence
  ) IS DISTINCT FROM (
    s.department, s.suggested_category, s.kind, s.confidence
  );
