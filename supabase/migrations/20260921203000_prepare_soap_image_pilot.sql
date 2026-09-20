update public.flyer_items
set
  image_url = null,
  image_source = null,
  image_confidence = null,
  image_match_status = 'soap_pending',
  image_query = null
where lower(raw_name) ~ '(^|[^a-záàâãéêíóôõúç])sabonete([^a-záàâãéêíóôõúç]|$)';
