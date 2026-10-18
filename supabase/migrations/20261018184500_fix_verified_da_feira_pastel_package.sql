-- Package metadata confirmed by the catalog owner for this specific
-- recorded item: "MASSA PASTEL DA FEIRA" is a 1 kg pastry dough roll.
-- No price, date, receipt, history, normalized price or brand is modified.
-- Guarded update: only this exact record and only when metadata is missing.
UPDATE public.products
SET package_size = 1, unit = 'kg'
WHERE id = 'f05ca0d7-06b1-488e-bc36-0c6fdc45b283'::uuid
  AND upper(btrim(name)) = 'MASSA PASTEL DA FEIRA'
  AND package_size IS NULL
  AND unit IS NULL;
