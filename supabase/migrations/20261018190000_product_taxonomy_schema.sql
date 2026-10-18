-- Persistent, conservative product-family classification.
-- These columns do not change prices, product_id links or receipt history.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS taxonomy_department text,
  ADD COLUMN IF NOT EXISTS taxonomy_category text,
  ADD COLUMN IF NOT EXISTS taxonomy_kind text,
  ADD COLUMN IF NOT EXISTS taxonomy_confidence text;

ALTER TABLE public.flyer_items
  ADD COLUMN IF NOT EXISTS taxonomy_department text,
  ADD COLUMN IF NOT EXISTS taxonomy_category text,
  ADD COLUMN IF NOT EXISTS taxonomy_kind text,
  ADD COLUMN IF NOT EXISTS taxonomy_confidence text;

-- Rules are server-managed, global, and readable by authenticated users;
-- no user can modify rules from the app.
CREATE TABLE IF NOT EXISTS public.product_taxonomy_rules (
  priority integer PRIMARY KEY,
  pattern text NOT NULL,
  department text NOT NULL,
  category text NOT NULL,
  kind text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high','review'))
);

ALTER TABLE public.product_taxonomy_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taxonomy_rules_select_authenticated
  ON public.product_taxonomy_rules;
CREATE POLICY taxonomy_rules_select_authenticated
  ON public.product_taxonomy_rules FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.product_taxonomy_rules TO authenticated;

CREATE INDEX IF NOT EXISTS products_taxonomy_user_kind_idx
  ON public.products (user_id, taxonomy_kind);
CREATE INDEX IF NOT EXISTS flyer_items_taxonomy_user_kind_idx
  ON public.flyer_items (user_id, taxonomy_kind);
