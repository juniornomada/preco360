import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FREE_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
] as const;

const EXTRACTION_PROMPT = `
Você é o extrator visual do Radar 360. Leia o encarte como uma pessoa olhando cada página, não como texto corrido de OCR.

OBJETIVO
Faça uma varredura completa do documento e devolva todas as ofertas que conseguir identificar com segurança, em JSON estruturado.

REGRAS OBRIGATÓRIAS
1. Nunca invente nome, preço, peso, sabor, loja ou condição. Se não conseguir ler nome + preço com segurança, ignore a oferta.
2. Um produto distinto = um registro. Se o encarte disser "Abóbora ... OU Repolho ... R$ 1,85/kg", crie DOIS registros, ambos a R$ 1,85/kg.
3. Variações do MESMO produto (sabores, cores, tipos) permanecem em um registro. Preencha included_types quando os tipos estiverem legíveis.
4. Se houver "tipos, exceto X/Y", mantenha o produto em um registro e coloque X/Y em excluded_types. Não misture a exceção no nome do produto.
5. Preço Clube/Vantagens deve ficar em club_price. O preço normal fica em price. Não substitua o preço normal pelo Clube.
6. Preserve a base original do anúncio em price_basis_quantity e price_basis_unit. Exemplos:
   - R$ 1,85/kg => 1 + kg
   - R$ 2,75 a cada 100g => 100 + g
   - pacote 600g por R$ 25,90 => package_quantity=600, package_unit=g e price_basis=1 un
7. package_quantity/package_unit representam o conteúdo da embalagem, não a base promocional, quando houver embalagem fechada.
8. Limites por cliente/compra vão em purchase_limit. Restrições de lojas/cidades vão em store_restrictions.
9. Mecânicas como "leve 12 pague 10", "leve 550g pague 500g", "vaso não incluso" e similares vão em notes.
10. product_name deve conter somente a identidade legível do produto, incluindo marca quando ela fizer parte natural do nome, mas sem preço, Clube, exceções ou restrições.
11. source_page é a página física do PDF, começando em 1.
12. confidence vai de 0 a 1. Só devolva registros com confiança >= 0.72.
13. Datas devem ser YYYY-MM-DD quando legíveis. Não deduza datas ausentes.
14. Preserve acentos e grafia do encarte quando legíveis.
15. Examine TODAS as páginas e TODAS as regiões: grade central, colunas laterais, rodapés e faixas promocionais.
16. Não pare após encontrar algumas dezenas de ofertas. Continue até o fim do documento.
17. Antes de finalizar, faça uma segunda varredura mental por página para encontrar células esquecidas.
18. Em produtos vendidos por peso, não confunda o preço com peso/volume. "1,35L" é embalagem de 1,35 litro, não preço de R$ 1,35.
19. Se um preço atende dois produtos separados por "ou", gere dois registros. Se "ou" apenas descreve variações do mesmo produto, mantenha um registro e coloque as variações em included_types.
20. Retorne JSON compacto, sem explicações fora do esquema.
21. TODOS os campos abaixo são obrigatórios em cada oferta. Quando não houver informação, use null, [] ou valor padrão apropriado; nunca omita o campo.
22. Use EXATAMENTE esta estrutura de saída:
{
  "retailer": "nome do mercado ou null",
  "valid_from": "YYYY-MM-DD ou null",
  "valid_to": "YYYY-MM-DD ou null",
  "page_count": 1,
  "offers": [
    {
      "product_name": "nome legível do produto",
      "brand": "marca ou null",
      "package_quantity": null,
      "package_unit": null,
      "price": 0,
      "price_basis_quantity": 1,
      "price_basis_unit": "un",
      "club_price": null,
      "included_types": [],
      "excluded_types": [],
      "store_restrictions": [],
      "purchase_limit": null,
      "notes": [],
      "source_page": 1,
      "image_box": {"x": 0, "y": 0, "width": 0, "height": 0},
      "image_box_confidence": 0,
      "confidence": 0.95
    }
  ]
}
23. Não use markdown, não envolva o JSON em crases e não escreva texto antes ou depois do objeto.
24. A IDENTIDADE COMERCIAL COMPLETA é prioridade. Para produto embalado, leia também a MARCA/LOGO impressa na embalagem, mesmo quando a legenda pequena do encarte trouxer só a categoria. Não devolva um nome genérico se a marca estiver visualmente legível.
25. product_name deve preservar categoria + marca + linha/modelo/variante comercial quando legíveis. brand deve repetir a marca isoladamente quando ela puder ser identificada.
26. Antes de finalizar cada página, revise TODOS os itens embalados com brand=null. Reabra mentalmente o quadrinho e procure a marca no pacote, garrafa, lata, sachê ou caixa. Se a marca estiver visível, preencha-a. Se realmente não estiver legível, mantenha null sem inventar.
27. Considere INCOMPLETOS nomes como "Arroz 5kg", "Azeite Extra Virgem 500ml", "Leite Pense Zero 1L", "Pão de Forma 400g", "Café em Pó 500g" quando a embalagem exibir uma marca legível. Nesses casos, releia o produto antes de responder.
28. Exemplos do nível de detalhe esperado quando isso estiver VISÍVEL no encarte:
   - "Achocolatado em Pó Fator Crescer 550g" deve virar "Achocolatado em Pó Nescau Fator Crescer 550g" se Nescau estiver visível.
   - "Azeite Extra Virgem 500ml" deve virar "Azeite Extra Virgem Saccioli 500ml" se Saccioli estiver visível.
   - "Leite Pense Zero 1L" deve virar "Leite Batavo Pense Zero 1L" se Batavo estiver visível.
   - "Pão de Forma 400g" deve incluir "Uni" quando essa marca estiver visível.
   - "Pão de Forma 500g" deve incluir "Confiança" quando essa marca estiver visível.
   Estes exemplos ensinam a REGRA; não use essas marcas em outros itens sem evidência visual.
29. Quando uma mesma oferta contém o MESMO tipo de produto e embalagem com marcas/linhas alternativas unidas por "ou" (ex.: "Arroz Riviera ou Patéko 5kg"), mantenha UMA oferta e preserve as alternativas no product_name. Quando forem produtos realmente diferentes (ex.: Abóbora e Repolho), continue criando registros separados.
30. Faça uma checagem final de completude por oferta nesta ordem: categoria do produto → marca → linha/modelo → sabor/tipo → embalagem → preço → Clube/exceções/limites. Só então finalize o JSON.
31. Antes de finalizar, consolide REPETIÇÕES do mesmo produto e mesma embalagem dentro do próprio encarte. Capa e páginas de destaque podem repetir uma oferta que reaparece depois na seção correta.
32. Se produto + embalagem + preço + condições forem equivalentes em duas páginas, devolva apenas UM registro e prefira a ocorrência mais completa/detalhada; em empate, prefira a ocorrência da página posterior (normalmente a seção da categoria) em vez da chamada de capa.
33. Se uma ocorrência mostrar apenas um preço promocional e outra ocorrência do mesmo produto/embalagem mostrar preço normal + Clube/Vantagens, e o preço promocional coincidir com o preço Clube, devolva somente a ocorrência completa com price normal e club_price.
34. NÃO consolide ofertas realmente distintas: se o mesmo produto tiver preços/condições diferentes sem relação entre preço normal e Clube, mantenha registros separados.
35. Para cada oferta, localize a FOTO/EMBALAGEM/PRODUTO VISUAL correspondente dentro da página e preencha image_box em coordenadas NORMALIZADAS de 0 a 1000, origem no canto superior esquerdo: x, y, width, height.
36. image_box deve enquadrar prioritariamente o PRODUTO VISUAL, não o preço grande, texto promocional nem anúncios vizinhos. Pode incluir pequena margem ao redor da embalagem/produto para evitar cortes.
37. Se o anúncio tiver mais de uma embalagem claramente pertencente à MESMA oferta, image_box pode enquadrar o conjunto dessas embalagens.
38. Se não houver imagem clara do produto, houver ambiguidade entre anúncios vizinhos ou você não conseguir localizar a imagem com segurança, use {"x":0,"y":0,"width":0,"height":0} e image_box_confidence=0.
39. image_box_confidence vai de 0 a 1 e mede APENAS a confiança de que a caixa recorta a imagem correta do produto. Só use valor >=0.80 quando a associação visual for realmente clara.
40. Antes de finalizar cada oferta, confirme que image_box está dentro de 0..1000, possui width/height positivos e pertence à mesma source_page da oferta.
41. image_box deve conter SOMENTE o produto visual principal da oferta. Não use a moldura inteira do quadrinho promocional.
42. Evite incluir nome do produto, preço, selo promocional, bordas da grade, produto de outra oferta acima/abaixo/lado ou qualquer texto vizinho.
43. Se duas embalagens diferentes aparecerem muito próximas, escolha apenas a embalagem que corresponde ao product_name desta oferta. Só agrupe duas embalagens quando ambas forem claramente a mesma oferta/mesma linha anunciada em conjunto.
44. Dê uma pequena folga ao redor do produto para não cortar embalagem, tampa, alça ou extremidades, mas essa folga deve ser mínima.
45. Se o produto estiver parcialmente encoberto ou próximo da borda do anúncio, expanda image_box o suficiente para recuperar o produto inteiro, sem invadir o anúncio vizinho.
46. Faça uma checagem visual final: se image_box incluir preço/texto em área relevante, mais de um anúncio diferente ou cortar parte evidente do produto, corrija a caixa antes de finalizar.
`;

type JobRow = {
  id: string;
  user_id: string;
  source_file_path: string;
  source_file_name: string;
  mime_type: string | null;
  file_hash: string | null;
  page_count: number | null;
  status: string;
  result: any;
  missing_pages: number[] | null;
  retailer: string | null;
  valid_from: string | null;
  valid_to: string | null;
  updated_at: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service credentials unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function callerIdentity(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (token && serviceKey && token === serviceKey) {
    return { isService: true, userId: null as string | null };
  }
  if (!token) return { isService: false, userId: null as string | null };

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return { isService: false, userId: null as string | null };

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { isService: false, userId: null as string | null };
  return { isService: false, userId: data.user.id };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function geminiText(payload: any) {
  for (const candidate of payload?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return "";
}

function parseJsonResponse(text: string) {
  const unfenced = text.trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error("Gemini returned invalid JSON.");
  }
}

function validOffers(parsed: any) {
  return Array.isArray(parsed?.offers)
    ? parsed.offers.filter((offer: any) =>
        Number(offer?.confidence ?? 0) >= 0.72 &&
        Number.isFinite(Number(offer?.price)) &&
        Number(offer.price) > 0 &&
        typeof offer?.product_name === "string" &&
        offer.product_name.trim())
    : [];
}

function normalizeOfferIdentity(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d)\s*[,\.]\s*(\d)/g, "$1.$2")
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|lt)\b/g, " ")
    .replace(
      /\b(?:pacote|embalagem|unidade|unidades|un|und|kg|g|ml|l|lt|sabor|sabores)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function offerIdentityKey(offer: any) {
  const quantity = Number(offer?.package_quantity);
  const quantityKey = Number.isFinite(quantity) && quantity > 0 ? String(quantity) : "";
  const unitKey = normalizeOfferIdentity(offer?.package_unit);
  return [
    normalizeOfferIdentity(offer?.product_name),
    quantityKey,
    unitKey,
  ].join("|");
}

function positiveMoney(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sameMoney(a: unknown, b: unknown) {
  const left = positiveMoney(a);
  const right = positiveMoney(b);
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.005;
}

function mergeableDuplicate(a: any, b: any) {
  if (offerIdentityKey(a) !== offerIdentityKey(b)) return false;

  const aPrice = positiveMoney(a?.price);
  const bPrice = positiveMoney(b?.price);
  const aClub = positiveMoney(a?.club_price);
  const bClub = positiveMoney(b?.club_price);
  if (aPrice === null || bPrice === null) return false;

  if (sameMoney(aPrice, bPrice)) {
    if (aClub !== null && bClub !== null && !sameMoney(aClub, bClub)) return false;
    return true;
  }

  if (aClub !== null && sameMoney(aClub, bPrice)) return true;
  if (bClub !== null && sameMoney(bClub, aPrice)) return true;

  return false;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function unionStrings(a: unknown, b: unknown) {
  const map = new Map<string, string>();
  for (const item of [...stringArray(a), ...stringArray(b)]) {
    const key = normalizeOfferIdentity(item);
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function offerRichness(offer: any) {
  let score = 0;
  if (positiveMoney(offer?.club_price) !== null) score += 12;
  if (offer?.brand) score += 3;
  if (positiveMoney(offer?.package_quantity) !== null && offer?.package_unit) score += 3;
  if (offer?.purchase_limit) score += 3;
  score += stringArray(offer?.included_types).length;
  score += stringArray(offer?.excluded_types).length * 2;
  score += stringArray(offer?.store_restrictions).length * 2;
  score += stringArray(offer?.notes).length * 2;
  score += Math.max(0, Math.min(1, Number(offer?.confidence) || 0));
  return score;
}

function preferredDuplicate(a: any, b: any) {
  const scoreA = offerRichness(a);
  const scoreB = offerRichness(b);
  if (scoreA !== scoreB) return scoreB > scoreA ? b : a;
  const pageA = Math.max(1, Math.trunc(Number(a?.source_page) || 1));
  const pageB = Math.max(1, Math.trunc(Number(b?.source_page) || 1));
  return pageB >= pageA ? b : a;
}

function mergeDuplicateDetails(preferred: any, other: any) {
  return {
    ...other,
    ...preferred,
    brand: preferred?.brand || other?.brand || null,
    package_quantity: preferred?.package_quantity ?? other?.package_quantity ?? null,
    package_unit: preferred?.package_unit || other?.package_unit || null,
    club_price: positiveMoney(preferred?.club_price) ?? positiveMoney(other?.club_price),
    included_types: unionStrings(preferred?.included_types, other?.included_types),
    excluded_types: unionStrings(preferred?.excluded_types, other?.excluded_types),
    store_restrictions: unionStrings(preferred?.store_restrictions, other?.store_restrictions),
    purchase_limit: preferred?.purchase_limit || other?.purchase_limit || null,
    notes: unionStrings(preferred?.notes, other?.notes),
    confidence: Math.max(Number(preferred?.confidence) || 0, Number(other?.confidence) || 0),
  };
}

function dedupeOffers(offers: any[]) {
  const deduped: any[] = [];
  for (const offer of offers) {
    const index = deduped.findIndex((existing) => mergeableDuplicate(existing, offer));
    if (index < 0) {
      deduped.push(offer);
      continue;
    }
    const existing = deduped[index];
    const preferred = preferredDuplicate(existing, offer);
    const other = preferred === existing ? offer : existing;
    deduped[index] = mergeDuplicateDetails(preferred, other);
  }
  return deduped.sort(
    (a, b) =>
      Math.max(1, Math.trunc(Number(a?.source_page) || 1)) -
      Math.max(1, Math.trunc(Number(b?.source_page) || 1)),
  );
}

async function runGemini(file: File, prompt: string, preferredModel?: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY não está configurada.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = bytesToBase64(bytes);
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const configured = String(Deno.env.get("GEMINI_MODEL") || "").trim();
  const freeSet = new Set<string>(FREE_GEMINI_MODELS);
  const preferred =
    (preferredModel && freeSet.has(preferredModel) && preferredModel) ||
    (freeSet.has(configured) && configured) ||
    FREE_GEMINI_MODELS[0];

  const body = {
    contents: [{ role: "user", parts: [
      { text: prompt },
      { inlineData: { mimeType, data: base64 } },
    ] }],
    generationConfig: { maxOutputTokens: 32768 },
  };

  let lastError = "Nenhum modelo Gemini gratuito disponível.";
  for (const model of Array.from(new Set([preferred, ...FREE_GEMINI_MODELS]))) {
    let response: Response;
    try {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(model) + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(105000),
        },
      );
    } catch (error) {
      lastError =
        error instanceof Error
          ? "Gemini não respondeu dentro do tempo esperado: " + error.message
          : "Gemini não respondeu dentro do tempo esperado.";
      continue;
    }
    const payload = await response.json().catch(async () => ({ message: await response.text() }));
    if (response.ok) {
      const text = geminiText(payload);
      if (!text) throw new Error("Gemini não retornou conteúdo estruturado.");
      return { parsed: parseJsonResponse(text), model };
    }
    const message =
      payload?.error?.message || payload?.message || "Falha ao analisar o tabloide.";
    lastError = "Gemini " + response.status + ": " + String(message).slice(0, 900);
    const fallbackEligible =
      response.status === 429 || response.status === 404 ||
      response.status === 403 || response.status >= 500;
    if (!fallbackEligible) throw new Error(lastError);
  }
  throw new Error(lastError);
}

async function fetchJob(jobId: string) {
  const { data, error } = await serviceClient()
    .from("flyer_import_jobs").select("*").eq("id", jobId).single();
  if (error) throw error;
  return data as JobRow;
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  const { error } = await serviceClient()
    .from("flyer_import_jobs")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw error;
}

async function downloadJobFile(job: JobRow) {
  const { data, error } = await serviceClient().storage
    .from("flyers").download(job.source_file_path);
  if (error || !data) throw error || new Error("Arquivo do tabloide não encontrado.");
  return new File([data], job.source_file_name, {
    type: job.mime_type || data.type ||
      (job.source_file_name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
  });
}

async function triggerRefine(jobId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Não foi possível iniciar o refinamento.");
  const response = await fetch(url + "/functions/v1/process-flyer-job", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, mode: "refine" }),
  });
  if (!response.ok) throw new Error("Falha ao agendar refinamento (" + response.status + ").");
}

async function triggerPage(jobId: string, pageNo: number) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Não foi possível continuar a importação.");

  const response = await fetch(url + "/functions/v1/process-flyer-job", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      job_id: jobId,
      mode: "page",
      page_no: pageNo,
    }),
  });

  if (!response.ok) {
    throw new Error(
      "Falha ao iniciar a página " + pageNo + " (" + response.status + ").",
    );
  }
}

async function processPage(jobId: string, requestedPage: number) {
  try {
    const job = await fetchJob(jobId);
    if (job.status === "completed") return;

    const total = Math.max(1, Math.trunc(Number(job.page_count) || 1));
    const pageNo = Math.max(1, Math.min(total, Math.trunc(Number(requestedPage) || 1)));
    const processedPages = Array.isArray(job.result?.processed_pages)
      ? job.result.processed_pages
          .map((value: unknown) => Math.trunc(Number(value) || 0))
          .filter((value: number) => value >= 1 && value <= total)
      : [];

    // Internal retries are idempotent. If this page was already persisted, continue
    // from the first unfinished page instead of duplicating offers.
    if (processedPages.includes(pageNo)) {
      const next = Array.from({ length: total }, (_, index) => index + 1)
        .find((value) => !processedPages.includes(value));
      if (next) await triggerPage(jobId, next);
      return;
    }

    await updateJob(jobId, {
      status: "processing",
      progress_current: processedPages.length,
      progress_total: total,
      progress_label:
        "Lendo página " + pageNo + "/" + total + " com IA no servidor…",
      error_message: null,
      warning_message: null,
    });

    const file = await downloadJobFile(job);
    const prompt =
      EXTRACTION_PROMPT +
      "\n\nEXECUÇÃO EM ETAPAS — PÁGINA ALVO " + pageNo + "/" + total +
      "\nAnalise SOMENTE a página física " + pageNo + " deste arquivo." +
      "\nIgnore completamente as demais páginas nesta execução." +
      "\nExtraia TODAS as ofertas visíveis da página alvo, inclusive os image_box." +
      "\nDefina source_page=" + pageNo + " em todos os registros retornados." +
      "\nNão omita ofertas só porque o mesmo produto pode aparecer em outra página." +
      "\nRetorne o mesmo formato JSON do schema principal.";

    const { parsed, model } = await runGemini(
      file,
      prompt,
      job.result?.model,
    );

    const pageOffers = validOffers(parsed).map((offer: any) => ({
      ...offer,
      source_page: pageNo,
    }));

    const previousOffers = Array.isArray(job.result?.offers)
      ? job.result.offers
      : [];
    const rawOfferCount =
      Math.max(
        previousOffers.length,
        Math.trunc(Number(job.result?.raw_offer_count) || 0),
      ) + pageOffers.length;
    const mergedRaw = [...previousOffers, ...pageOffers];
    const offers = dedupeOffers(mergedRaw);
    const completedPages = [...new Set([...processedPages, pageNo])].sort(
      (a, b) => a - b,
    );

    const result = {
      ...(job.result ?? {}),
      ok: true,
      engine: "gemini-vision",
      model,
      retailer:
        parsed.retailer ??
        job.result?.retailer ??
        job.retailer ??
        null,
      valid_from:
        parsed.valid_from ??
        job.result?.valid_from ??
        job.valid_from ??
        null,
      valid_to:
        parsed.valid_to ??
        job.result?.valid_to ??
        job.valid_to ??
        null,
      page_count: total,
      processed_pages: completedPages,
      raw_offer_count: rawOfferCount,
      deduplicated_count: Math.max(0, rawOfferCount - offers.length),
      offers,
    };

    if (completedPages.length >= total) {
      if (!offers.length) {
        throw new Error(
          "A leitura terminou, mas nenhuma oferta confiável foi encontrada.",
        );
      }

      await updateJob(jobId, {
        status: "completed",
        progress_current: total,
        progress_total: total,
        progress_label:
          offers.length + " ofertas importadas com sucesso." +
          (result.deduplicated_count
            ? " " + result.deduplicated_count + " repetição(ões) consolidada(s)."
            : ""),
        retailer: result.retailer,
        valid_from: result.valid_from,
        valid_to: result.valid_to,
        result,
        missing_pages: [],
        completed_at: new Date().toISOString(),
      });
      return;
    }

    await updateJob(jobId, {
      status: "processing",
      progress_current: completedPages.length,
      progress_total: total,
      progress_label:
        "Página " + pageNo + "/" + total +
        " concluída · " + offers.length + " ofertas acumuladas. Continuando…",
      retailer: result.retailer,
      valid_from: result.valid_from,
      valid_to: result.valid_to,
      result,
      completed_at: null,
    });

    const nextPage = Array.from({ length: total }, (_, index) => index + 1)
      .find((value) => !completedPages.includes(value));
    if (nextPage) await triggerPage(jobId, nextPage);
  } catch (error) {
    console.error("process-flyer-job page", requestedPage, error);
    await updateJob(jobId, {
      status: "failed",
      progress_label:
        "A importação parou na página " + requestedPage + ". Você pode tentar novamente.",
      error_message:
        error instanceof Error
          ? error.message
          : "Falha inesperada ao processar esta página.",
      completed_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

async function processInitial(jobId: string) {
  try {
    const job = await fetchJob(jobId);
    const total = Math.max(1, Number(job.page_count) || 1);
    await updateJob(jobId, {
      status: "processing",
      progress_current: 1,
      progress_total: total,
      progress_label: "Arquivo enviado. Analisando o tabloide no servidor…",
      error_message: null,
      warning_message: null,
    });

    const file = await downloadJobFile(job);
    const { parsed, model } = await runGemini(
      file,
      EXTRACTION_PROMPT +
        "\n\nExtraia todas as ofertas deste tabloide agora. Faça a leitura página por página e só finalize depois de revisar todas as páginas.",
    );

    const rawOffers = validOffers(parsed);
    if (!rawOffers.length) throw new Error("A IA terminou a leitura, mas não retornou ofertas confiáveis.");
    const offers = dedupeOffers(rawOffers);
    const deduplicatedCount = rawOffers.length - offers.length;
    const pageCount = Math.max(1, Math.trunc(Number(job.page_count) || Number(parsed.page_count) || 1));
    const covered = new Set(
      rawOffers.map((o: any) => Math.trunc(Number(o.source_page) || 0))
        .filter((p: number) => p >= 1 && p <= pageCount),
    );
    const missing = file.type === "application/pdf"
      ? Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => !covered.has(p))
      : [];

    const result = {
      ok: true,
      engine: "gemini-vision",
      model,
      retailer: parsed.retailer ?? job.retailer ?? null,
      valid_from: parsed.valid_from ?? job.valid_from ?? null,
      valid_to: parsed.valid_to ?? job.valid_to ?? null,
      page_count: pageCount,
      deduplicated_count: deduplicatedCount,
      offers,
    };

    if (missing.length) {
      await updateJob(jobId, {
        status: "refining",
        progress_current: Math.max(1, covered.size),
        progress_total: pageCount,
        progress_label: "Leitura principal concluída. Refinando " + missing.length + " página(s) no servidor…",
        retailer: result.retailer,
        valid_from: result.valid_from,
        valid_to: result.valid_to,
        page_count: pageCount,
        result,
        missing_pages: missing,
      });
      try {
        await triggerRefine(jobId);
      } catch (error) {
        await updateJob(jobId, {
          status: "completed",
          progress_current: pageCount,
          progress_total: pageCount,
          progress_label: "Importação concluída com leitura parcial.",
          warning_message: error instanceof Error ? error.message : "O refinamento não pôde ser iniciado.",
          completed_at: new Date().toISOString(),
        });
      }
      return;
    }

    await updateJob(jobId, {
      status: "completed",
      progress_current: pageCount,
      progress_total: pageCount,
      progress_label:
        offers.length + " ofertas importadas com sucesso." +
        (deduplicatedCount ? " " + deduplicatedCount + " repetição(ões) consolidada(s)." : ""),
      retailer: result.retailer,
      valid_from: result.valid_from,
      valid_to: result.valid_to,
      page_count: pageCount,
      result,
      missing_pages: [],
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("process-flyer-job initial", error);
    await updateJob(jobId, {
      status: "failed",
      progress_label: "Falha ao importar o tabloide.",
      error_message: error instanceof Error ? error.message : "Falha inesperada na importação.",
      completed_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

async function processRefine(jobId: string) {
  try {
    const job = await fetchJob(jobId);
    const missing = Array.isArray(job.missing_pages) ? job.missing_pages.filter(Number.isInteger) : [];
    if (!missing.length || !job.result?.offers?.length) {
      const total = Math.max(1, Number(job.page_count) || 1);
      await updateJob(jobId, {
        status: "completed",
        progress_current: total,
        progress_total: total,
        progress_label: "Importação concluída.",
        completed_at: new Date().toISOString(),
      });
      return;
    }

    const file = await downloadJobFile(job);
    const { parsed, model } = await runGemini(
      file,
      EXTRACTION_PROMPT +
        "\n\nREFINAMENTO DE COMPLETUDE\nA primeira leitura não retornou ofertas nas páginas físicas: " +
        missing.join(", ") +
        ".\nAnalise SOMENTE essas páginas do PDF e extraia todas as ofertas legíveis nelas." +
        "\nMantenha source_page com o número físico original da página." +
        "\nNão repita ofertas de páginas diferentes das solicitadas." +
        "\nSe uma página realmente não contiver ofertas, não invente registros.",
      job.result?.model,
    );

    const allowed = new Set(missing);
    const refined = validOffers(parsed).filter((o: any) =>
      allowed.has(Math.trunc(Number(o.source_page) || 0)));
    const mergedRaw = [...(job.result.offers ?? []), ...refined];
    const offers = dedupeOffers(mergedRaw);
    const newlyDeduplicated = mergedRaw.length - offers.length;
    const deduplicatedCount =
      Math.max(0, Number(job.result?.deduplicated_count) || 0) + newlyDeduplicated;
    const refinedPages = new Set(
      refined.map((o: any) => Math.trunc(Number(o.source_page) || 0)),
    );
    const remaining = missing.filter((p) => !refinedPages.has(p));
    const total = Math.max(1, Number(job.page_count) || Number(job.result.page_count) || 1);

    await updateJob(jobId, {
      status: "completed",
      progress_current: total,
      progress_total: total,
      progress_label:
        offers.length + " ofertas importadas com sucesso." +
        (deduplicatedCount ? " " + deduplicatedCount + " repetição(ões) consolidada(s)." : ""),
      result: {
        ...job.result,
        model,
        offers,
        refined_pages: [...refinedPages],
        deduplicated_count: deduplicatedCount,
      },
      missing_pages: remaining,
      warning_message: remaining.length
        ? "A IA não encontrou ofertas confiáveis em " + remaining.length + " página(s): " + remaining.join(", ") + "."
        : null,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("process-flyer-job refine", error);
    const job = await fetchJob(jobId).catch(() => null);
    const total = Math.max(1, Number(job?.page_count) || 1);
    await updateJob(jobId, {
      status: "completed",
      progress_current: total,
      progress_total: total,
      progress_label: "Importação concluída; o refinamento adicional não terminou.",
      warning_message: error instanceof Error ? error.message : "Falha no refinamento adicional.",
      completed_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const body = await req.json();
    const jobId = String(body?.job_id || "").trim();
    const mode = String(body?.mode || "start");
    if (!jobId) return json(400, { error: "JOB_ID_REQUIRED" });

    const caller = await callerIdentity(req);
    const job = await fetchJob(jobId);
    const isOwner = !!caller.userId && caller.userId === job.user_id;
    if (!caller.isService && !isOwner) return json(403, { error: "FORBIDDEN" });
    if (job.status === "completed") {
      return json(200, { ok: true, job_id: jobId, status: "completed" });
    }

    const total = Math.max(1, Math.trunc(Number(job.page_count) || 1));
    const processedPages = Array.isArray(job.result?.processed_pages)
      ? job.result.processed_pages
          .map((value: unknown) => Math.trunc(Number(value) || 0))
          .filter((value: number) => value >= 1 && value <= total)
      : [];

    let pageNo = 1;
    if (mode === "page") {
      pageNo = Math.max(
        1,
        Math.min(total, Math.trunc(Number(body?.page_no) || 1)),
      );
    } else if (mode === "resume") {
      pageNo =
        Array.from({ length: total }, (_, index) => index + 1)
          .find((value) => !processedPages.includes(value)) ?? total;
    }

    // New architecture: each invocation processes exactly one physical page,
    // persists it, then starts the next page in a separate invocation.
    EdgeRuntime.waitUntil(processPage(jobId, pageNo));

    return json(202, {
      ok: true,
      job_id: jobId,
      status: "processing",
      page_no: pageNo,
      progress_current: processedPages.length,
      progress_total: total,
    });
  } catch (error) {
    console.error("process-flyer-job handler", error);
    return json(500, {
      error: "JOB_START_FAILED",
      message: error instanceof Error ? error.message : "Falha ao iniciar a importação.",
    });
  }
});
