-- Safe/idempotent backfill using vetted classification rules.
-- Unknown and review-only products retain "Geral" unless user set a category.
-- No price, offer amount, package metadata, product ID, alias or receipt data
-- is touched. This script runs only when database migrations are deployed.
-- Flyer data are backfilled in four separate, smaller migrations to reduce
-- statement duration and lock scope.

WITH suggestions AS (
  SELECT p.id, c.department, c.category AS suggested_category,
    c.kind, c.confidence
  FROM public.products AS p
  LEFT JOIN LATERAL public.classify_catalog_product_v1(p.name) AS c ON true
)
UPDATE public.products AS p
SET taxonomy_department = s.department,
    taxonomy_category = s.suggested_category,
    taxonomy_kind = s.kind,
    taxonomy_confidence = s.confidence,
    category = CASE WHEN p.category = 'Geral' AND s.confidence = 'high'
      THEN s.suggested_category ELSE p.category END
FROM suggestions AS s
WHERE p.id = s.id
  AND (
    p.taxonomy_department, p.taxonomy_category,
    p.taxonomy_kind, p.taxonomy_confidence, p.category
  ) IS DISTINCT FROM (
    s.department, s.suggested_category, s.kind, s.confidence,
    CASE WHEN p.category = 'Geral' AND s.confidence = 'high'
      THEN s.suggested_category ELSE p.category END
  );
