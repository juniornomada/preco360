update public.flyer_items
set
  image_url = null,
  image_source = null,
  image_confidence = null,
  image_match_status = 'soap_pending',
  image_query = null
where raw_name in (
  'Kit Sabonete Palmolive Fragrâncias 8un',
  'Sabonete Albany Gelato/ Un 80g',
  'Sabonete Nivea Barra Hidratante Pacote 85g',
  'Sabonete Francis Clássico Fragrâncias Caixa 90g',
  'Sabonete Dove 540g'
);
