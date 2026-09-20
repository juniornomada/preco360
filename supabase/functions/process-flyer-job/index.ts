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
5A. NUNCA coloque em club_price valores meramente equivalentes de quantidade, como "nesta embalagem 350g saem por R$ 7,67", "1 unidade sai por R$ 1,25", "cada 100g sai por..." ou divisão de pack/fardo. Esses valores vão apenas em notes; club_price deve ser null se não houver selo/texto explícito de Clube/Vantagens/CPF/app associado ao preço.
5B. Mecânicas de quantidade como "a partir de 2 unidades", "20% na segunda unidade", "leve X pague Y" também NÃO são club_price, salvo se o encarte identificar explicitamente aquele valor como Clube/Vantagens.
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
13A. O campo retailer deve conter o NOME OFICIAL DA REDE/SUPERMERCADO, identificado principalmente pelo logotipo, assinatura institucional ou nome repetido como marca da loja. NÃO use como retailer o nome de campanha, slogan, evento promocional ou chamada publicitária.
13B. Expressões como "Festival do...", "Semana...", "Mês...", "Real Gigante", "Ofertas Gigantes", "Aniversário", "Feirão" e semelhantes são campanhas/slogans quando aparecem destacadas junto da marca. Exemplo: se a peça mostra o logotipo "MAX Atacadista" e o título "Festival do REAL GIGANTE", retailer deve ser "Max Atacadista", nunca "Real Atacadista".
13C. Quando houver dúvida entre um título promocional grande e uma marca/logotipo menor, prefira a marca/logotipo que identifica a rede. Antes de finalizar retailer, confira cabeçalho, rodapé, assinatura visual e outras páginas do mesmo tabloide.
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
`;

type JobRow = {
  id: string;
  user_id: string;
  source_file_path: string;
  source_file_name: string;
  mime_type: string | null;
  source_files?: Array<{
    path: string;
    name: string;
    mime_type?: string | null;
    size?: number | null;
  }> | null;
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
  const cleaned = text.trim()
    .replace(/^\uFEFF/, "")
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate =
    start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  const attempts = [
    cleaned,
    candidate,
    candidate
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
      .replace(/[“”]/g, '"'),
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("A IA retornou JSON inválido.");
}

function alignDateYearToSource(value: unknown, sourceFileName: string) {
  const date = typeof value === "string" ? value.trim() : "";
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return value ?? null;

  const sourceYear =
    sourceFileName.match(/(?:^|[_-])(20\d{2})(?=[_.-]|$)/)?.[1] ?? null;
  if (!sourceYear) return date;

  const detectedYear = Number(date.slice(0, 4));
  const expectedYear = Number(sourceYear);
  if (
    Number.isFinite(detectedYear) &&
    Number.isFinite(expectedYear) &&
    Math.abs(detectedYear - expectedYear) === 1
  ) {
    return sourceYear + date.slice(4);
  }

  return date;
}

function sanitizeOfferPricing(offer: any) {
  const price = Number(offer?.price);
  const club = Number(offer?.club_price);
  const notes = Array.isArray(offer?.notes)
    ? offer.notes.map((value: unknown) => String(value ?? ""))
    : [];

  let keepClub = Number.isFinite(club) && club > 0;

  if (keepClub && Number.isFinite(price) && price > 0 && club > price) {
    keepClub = false;
  }

  if (keepClub) {
    const equivalentNotes = notes.filter((note: string) =>
      /nesta embalagem|unidade sai|un saem por|cada\s+\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|un)/i.test(note)
    );

    for (const note of equivalentNotes) {
      const values = [...note.matchAll(/R\$\s*(\d+(?:[.,]\d{1,2})?)/gi)]
        .map((match) => Number(match[1].replace(",", ".")))
        .filter((value) => Number.isFinite(value));
      if (values.some((value) => Math.abs(value - club) < 0.011)) {
        keepClub = false;
        break;
      }
    }
  }

  if (keepClub && notes.some((note: string) => /com\s+2\s+(?:latas|unidades|un\b)/i.test(note))) {
    if (Number.isFinite(price) && price > 0 && Math.abs(club - price / 2) < 0.02) {
      keepClub = false;
    }
  }

  return {
    ...offer,
    club_price: keepClub ? club : null,
  };
}

function validOffers(parsed: any) {
  return Array.isArray(parsed?.offers)
    ? parsed.offers
        .map((offer: any) => sanitizeOfferPricing(offer))
        .filter((offer: any) =>
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
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|lt|un|und|unid|unidade)\b/g, " ")
    .replace(
      /\b(?:de|da|do|das|dos|tipo|tipos|sabor|sabores|pacote|embalagem|unidade|unidades|un|und|kg|g|ml|l|lt|lata|sache|garrafa|bandeja|fardo|fresco|fresca|congelado|congelada)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedPackageIdentity(offer: any) {
  const quantity = Number(offer?.package_quantity);
  const unit = normalizeOfferIdentity(offer?.package_unit);
  if (!Number.isFinite(quantity) || quantity <= 0 || !unit) {
    return { quantity: null as number | null, unit };
  }
  if (unit === "kg") return { quantity: quantity * 1000, unit: "g" };
  if (unit === "g") return { quantity, unit: "g" };
  if (unit === "l" || unit === "lt") return { quantity: quantity * 1000, unit: "ml" };
  if (unit === "ml") return { quantity, unit: "ml" };
  if (["un","und","unid","unidade"].includes(unit)) return { quantity, unit: "un" };
  return { quantity, unit };
}

function offerIdentityKey(offer: any) {
  const pkg = normalizedPackageIdentity(offer);
  const quantityKey =
    pkg.quantity !== null ? String(Math.round(pkg.quantity * 1000) / 1000) : "";
  return [
    normalizeOfferIdentity(offer?.product_name),
    quantityKey,
    pkg.unit,
  ].join("|");
}

function identityDice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (value: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i += 1) {
      const gram = value.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };
  const A = grams(a);
  const B = grams(b);
  let intersection = 0;
  for (const [gram, count] of A) {
    intersection += Math.min(count, B.get(gram) ?? 0);
  }
  const totalA = [...A.values()].reduce((sum, value) => sum + value, 0);
  const totalB = [...B.values()].reduce((sum, value) => sum + value, 0);
  return (2 * intersection) / Math.max(1, totalA + totalB);
}

function packageCompatible(a: any, b: any) {
  const left = normalizedPackageIdentity(a);
  const right = normalizedPackageIdentity(b);

  if (left.unit && right.unit && left.unit !== right.unit) return false;
  if (left.quantity !== null && right.quantity !== null) {
    return Math.abs(left.quantity - right.quantity) < 0.01;
  }
  return true;
}

function brandCompatible(a: any, b: any) {
  const left = normalizeOfferIdentity(a?.brand);
  const right = normalizeOfferIdentity(b?.brand);
  if (!left || !right || left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return identityDice(left, right) >= 0.9;
}

function sameOfferIdentity(a: any, b: any) {
  if (offerIdentityKey(a) === offerIdentityKey(b)) return true;
  if (!packageCompatible(a, b) || !brandCompatible(a, b)) return false;

  const left = normalizeOfferIdentity(a?.product_name);
  const right = normalizeOfferIdentity(b?.product_name);
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.split(" ").filter(Boolean).length >= 3 && longer.includes(shorter)) return true;

  return identityDice(left, right) >= 0.86;
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
  if (!sameOfferIdentity(a, b)) return false;

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

  const isImagePage = mimeType.startsWith("image/");
  const body = {
    contents: [{ role: "user", parts: [
      { text: prompt },
      { inlineData: { mimeType, data: base64 } },
    ] }],
    generationConfig: {
      responseMimeType: "application/json",
      // A single flyer image normally needs far less output than a whole PDF.
      // Keeping a generous cap preserves completeness while reducing long-tail latency.
      maxOutputTokens: isImagePage ? 24576 : 32768,
      temperature: 0,
    },
  };

  const allCandidates = Array.from(new Set([preferred, ...FREE_GEMINI_MODELS]));
  // Multi-image flyers process one physical page per invocation. Two model
  // attempts are enough here and keep the invocation safely below the Edge
  // Function lifetime when a provider call stalls. PDFs keep the broader
  // fallback list because they are heavier and less predictable.
  const modelCandidates = isImagePage
    ? allCandidates.slice(0, 2)
    : allCandidates;
  const requestTimeoutMs = isImagePage ? 55000 : 105000;

  let lastError = "Nenhum modelo Gemini gratuito disponível.";
  for (const model of modelCandidates) {
    let response: Response;
    try {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(model) + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(requestTimeoutMs),
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
      if (!text) {
        lastError = "Gemini não retornou conteúdo estruturado.";
        continue;
      }
      try {
        return { parsed: parseJsonResponse(text), model };
      } catch (parseError) {
        lastError =
          "JSON inválido no modelo " + model + ": " +
          (parseError instanceof Error ? parseError.message : String(parseError));
        continue;
      }
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

function validLocatorBox(value: any) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const width = Number(value?.width);
  const height = Number(value?.height);
  const confidence = Math.max(0, Math.min(1, Number(value?.confidence) || 0));

  const valid =
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 && y >= 0 &&
    width > 8 && height > 8 &&
    x < 1000 && y < 1000 &&
    x + width <= 1005 &&
    y + height <= 1005 &&
    width <= 340 &&
    height <= 360;

  if (!valid || confidence < 0.82) {
    return {
      image_box: { x: 0, y: 0, width: 0, height: 0 },
      image_box_confidence: 0,
    };
  }

  return {
    image_box: {
      x: Math.max(0, Math.min(999, x)),
      y: Math.max(0, Math.min(999, y)),
      width: Math.max(1, Math.min(1000 - x, width)),
      height: Math.max(1, Math.min(1000 - y, height)),
    },
    image_box_confidence: confidence,
  };
}

function boxOverlap(a: any, b: any) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return intersection / Math.max(1, minArea);
}

async function locatePageImages(
  file: File,
  pageNo: number,
  total: number,
  pageOffers: any[],
  preferredModel?: string,
) {
  if (!pageOffers.length) return pageOffers;

  const manifest = pageOffers.map((offer, index) => ({
    index,
    product_name: offer.product_name,
    brand: offer.brand ?? null,
    package_quantity: offer.package_quantity ?? null,
    package_unit: offer.package_unit ?? null,
    price: offer.price ?? null,
  }));

  const prompt = `
LOCALIZAÇÃO VISUAL DE PRODUTOS — PÁGINA ${pageNo}/${total}

Analise SOMENTE a página física ${pageNo} deste tabloide.
A extração de texto/preço já foi feita. Sua única tarefa agora é localizar a FOTO/EMBALAGEM visual correspondente a cada oferta abaixo.

OFERTAS:
${JSON.stringify(manifest)}

Regras obrigatórias:
1. Para cada index, localize SOMENTE a imagem visual do produto correspondente àquele product_name.
2. NÃO enquadre o quadrinho promocional inteiro.
3. NÃO inclua preço, nome do produto, texto promocional, bordas verdes, selo, QR code ou anúncio vizinho.
4. Se houver duas ofertas próximas, confirme visualmente marca/tipo/tamanho antes de escolher a imagem.
5. Não use a imagem de um produto vizinho apenas porque está mais perto do texto.
6. Para ofertas "tipos", pode enquadrar várias embalagens SOMENTE se forem claramente variações da mesma linha anunciada.
7. Para hortifruti/carnes/granel, enquadre apenas a foto do alimento correspondente.
8. Dê margem pequena para não cortar embalagem, tampa ou extremidades.
9. Coordenadas normalizadas 0..1000 com origem no canto superior esquerdo da página.
10. Se não houver uma imagem clara e inequívoca do produto, devolva confidence=0 e caixa zerada.
11. Confidence >=0.82 somente quando a imagem visual corresponde claramente à oferta.
12. Antes de responder, confira se nenhuma caixa aponta para texto/preço ou para um produto diferente.

Retorne SOMENTE JSON válido:
{
  "boxes": [
    {
      "index": 0,
      "x": 0,
      "y": 0,
      "width": 0,
      "height": 0,
      "confidence": 0
    }
  ]
}
`;

  const { parsed } = await runGemini(file, prompt, preferredModel);
  const rows = Array.isArray(parsed?.boxes) ? parsed.boxes : [];
  const byIndex = new Map<number, any>();

  for (const row of rows) {
    const index = Math.trunc(Number(row?.index));
    if (index < 0 || index >= pageOffers.length) continue;
    byIndex.set(index, validLocatorBox(row));
  }

  const located = pageOffers.map((offer, index) => ({
    ...offer,
    ...(byIndex.get(index) ?? {
      image_box: { x: 0, y: 0, width: 0, height: 0 },
      image_box_confidence: 0,
    }),
  }));

  // Two different offers should not receive virtually the same product image box.
  // When that happens, suppress the weaker one instead of showing a wrong thumbnail.
  for (let i = 0; i < located.length; i++) {
    const a = located[i];
    if (Number(a.image_box_confidence) < 0.82) continue;
    for (let j = i + 1; j < located.length; j++) {
      const b = located[j];
      if (Number(b.image_box_confidence) < 0.82) continue;
      if (boxOverlap(a.image_box, b.image_box) < 0.72) continue;

      const aConfidence = Number(a.image_box_confidence) || 0;
      const bConfidence = Number(b.image_box_confidence) || 0;
      const loser = aConfidence >= bConfidence ? b : a;
      loser.image_box = { x: 0, y: 0, width: 0, height: 0 };
      loser.image_box_confidence = 0;
    }
  }

  return located;
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

async function knownRetailerNames(userId: string) {
  const { data, error } = await serviceClient()
    .from("flyers")
    .select("retailer,created_at")
    .eq("user_id", userId)
    .not("retailer", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    console.warn("Não foi possível carregar redes conhecidas:", error.message);
    return [] as string[];
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row: any) => String(row.retailer ?? "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

async function downloadJobFile(job: JobRow, pageNo?: number) {
  const orderedSources = Array.isArray(job.source_files)
    ? job.source_files.filter((source) => source?.path && source?.name)
    : [];

  const source =
    orderedSources.length > 1 && pageNo
      ? orderedSources[Math.max(0, Math.min(orderedSources.length - 1, pageNo - 1))]
      : null;

  const path = source?.path || job.source_file_path;
  const name = source?.name || job.source_file_name;
  const mimeType = source?.mime_type || job.mime_type;

  const { data, error } = await serviceClient().storage
    .from("flyers").download(path);
  if (error || !data) throw error || new Error("Arquivo do tabloide não encontrado.");

  return new File([data], name, {
    type: mimeType || data.type ||
      (name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
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

function isTransientAiFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timed out|timeout|429|resource exhausted|overloaded|temporar|502|503|504/i.test(message);
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

async function extractPhysicalPage(
  job: JobRow,
  total: number,
  pageNo: number,
  knownRetailers: string[] = [],
) {
  const file = await downloadJobFile(job, pageNo);
  const multiImagePages =
    Array.isArray(job.source_files) && job.source_files.length > 1;
  const prompt =
    EXTRACTION_PROMPT +
    "\n\nEXECUÇÃO EM ETAPAS — PÁGINA ALVO " + pageNo + "/" + total +
    (multiImagePages
      ? "\nEsta imagem corresponde à página física " + pageNo + " do tabloide."
      : "\nAnalise SOMENTE a página física " + pageNo + " deste arquivo.") +
    (multiImagePages
      ? "\nAnalise integralmente esta imagem e extraia todas as ofertas visíveis."
      : "\nIgnore completamente as demais páginas nesta execução.") +
    "\nExtraia TODAS as ofertas visíveis da página alvo." +
    "\nNÃO localize imagens nesta etapa: use image_box zerado e image_box_confidence=0. As miniaturas serão resolvidas depois pelo nome do produto." +
    "\nDefina source_page=" + pageNo + " em todos os registros retornados." +
    "\nNão omita ofertas só porque o mesmo produto pode aparecer em outra página." +
    (knownRetailers.length
      ? "\nREDES JÁ CONHECIDAS NO HISTÓRICO DESTE USUÁRIO: " +
        knownRetailers.join(", ") +
        ". Use estes nomes apenas como referência quando a identidade visual/logotipo da página for compatível. Não force uma rede conhecida se o tabloide for de uma rede nova."
      : "") +
    "\nRetorne o mesmo formato JSON do schema principal.";

  const { parsed, model } = await runGemini(
    file,
    prompt,
    job.result?.model,
  );

  const pageOffers = validOffers(parsed).map((offer: any) => ({
    ...offer,
    source_page: pageNo,
    image_box: { x: 0, y: 0, width: 0, height: 0 },
    image_box_confidence: 0,
  }));

  return { pageNo, parsed, model, pageOffers };
}

async function processPage(jobId: string, requestedPage: number) {
  try {
    const job = await fetchJob(jobId);
    if (job.status === "completed") return;

    const total = Math.max(1, Math.trunc(Number(job.page_count) || 1));
    const processedPages = Array.isArray(job.result?.processed_pages)
      ? job.result.processed_pages
          .map((value: unknown) => Math.trunc(Number(value) || 0))
          .filter((value: number) => value >= 1 && value <= total)
      : [];

    const pendingPages = Array.from(
      { length: total },
      (_, index) => index + 1,
    ).filter((value) => !processedPages.includes(value));

    if (!pendingPages.length) return;

    const requested = Math.max(
      1,
      Math.min(total, Math.trunc(Number(requestedPage) || 1)),
    );
    const startPage = pendingPages.includes(requested)
      ? requested
      : pendingPages[0];

    const multiImagePages =
      Array.isArray(job.source_files) && job.source_files.length > 1;

    // Image flyers are independent physical files, so two pages can be read in
    // parallel without mixing their OCR/extraction context. PDFs remain one page
    // per invocation to avoid sending the same large PDF twice concurrently.
    const pagesToProcess = multiImagePages
      ? [
          startPage,
          ...pendingPages.filter((page) => page !== startPage).slice(0, 1),
        ]
      : [startPage];

    const pageLabel =
      pagesToProcess.length > 1
        ? pagesToProcess.join(" e ") + " de " + total
        : pagesToProcess[0] + "/" + total;

    await updateJob(jobId, {
      status: "processing",
      progress_current: processedPages.length,
      progress_total: total,
      progress_label:
        (pagesToProcess.length > 1 ? "Lendo páginas " : "Lendo página ") +
        pageLabel +
        " com IA no servidor…",
      error_message: null,
      warning_message: null,
    });

    const knownRetailers = await knownRetailerNames(job.user_id);

    const settled = await Promise.allSettled(
      pagesToProcess.map((pageNo) =>
        extractPhysicalPage(job, total, pageNo, knownRetailers),
      ),
    );

    const successes: Array<Awaited<ReturnType<typeof extractPhysicalPage>>> = [];
    const failures: Array<{ pageNo: number; error: unknown }> = [];

    settled.forEach((entry, index) => {
      const pageNo = pagesToProcess[index];
      if (entry.status === "fulfilled") {
        successes.push(entry.value);
      } else {
        failures.push({ pageNo, error: entry.reason });
      }
    });

    const previousOffers = Array.isArray(job.result?.offers)
      ? job.result.offers
      : [];
    const addedOffers = successes.flatMap((entry) => entry.pageOffers);
    const baseRawOfferCount = Math.max(
      previousOffers.length,
      Math.trunc(Number(job.result?.raw_offer_count) || 0),
    );
    const rawOfferCount = baseRawOfferCount + addedOffers.length;
    const offers = dedupeOffers([...previousOffers, ...addedOffers]);
    const completedPages = [
      ...new Set([
        ...processedPages,
        ...successes.map((entry) => entry.pageNo),
      ]),
    ].sort((a, b) => a - b);

    let retailer =
      job.result?.retailer ??
      job.retailer ??
      null;
    let validFrom =
      job.result?.valid_from ??
      job.valid_from ??
      null;
    let validTo =
      job.result?.valid_to ??
      job.valid_to ??
      null;
    let model = job.result?.model ?? null;

    for (const success of successes) {
      model = success.model || model;
      retailer = success.parsed.retailer ?? retailer;
      validFrom = alignDateYearToSource(
        success.parsed.valid_from ?? validFrom,
        job.source_file_name,
      );
      validTo = alignDateYearToSource(
        success.parsed.valid_to ?? validTo,
        job.source_file_name,
      );
    }

    const retryCounts =
      job.result?.page_retry_counts &&
      typeof job.result.page_retry_counts === "object"
        ? { ...job.result.page_retry_counts }
        : {};

    let terminalFailure:
      | { pageNo: number; message: string }
      | null = null;

    for (const failure of failures) {
      const message =
        failure.error instanceof Error
          ? failure.error.message
          : String(failure.error ?? "Falha inesperada ao processar esta página.");
      const currentRetries = Math.max(
        0,
        Math.trunc(Number(retryCounts[String(failure.pageNo)]) || 0),
      );

      if (isTransientAiFailure(failure.error) && currentRetries < 2) {
        retryCounts[String(failure.pageNo)] = currentRetries + 1;
      } else if (!terminalFailure) {
        terminalFailure = {
          pageNo: failure.pageNo,
          message,
        };
      }
    }

    const result = {
      ...(job.result ?? {}),
      ok: true,
      engine: "gemini-vision",
      model,
      retailer,
      valid_from: validFrom,
      valid_to: validTo,
      page_count: total,
      processed_pages: completedPages,
      page_retry_counts: retryCounts,
      raw_offer_count: rawOfferCount,
      deduplicated_count: Math.max(0, rawOfferCount - offers.length),
      offers,
    };

    if (terminalFailure) {
      await updateJob(jobId, {
        status: "failed",
        progress_current: completedPages.length,
        progress_total: total,
        progress_label:
          "A importação parou na página " +
          terminalFailure.pageNo +
          ". O progresso anterior foi preservado.",
        retailer,
        valid_from: validFrom,
        valid_to: validTo,
        result,
        error_message: terminalFailure.message,
        completed_at: new Date().toISOString(),
      });
      return;
    }

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
            ? " " +
              result.deduplicated_count +
              " repetição(ões) consolidada(s)."
            : ""),
        retailer,
        valid_from: validFrom,
        valid_to: validTo,
        result,
        missing_pages: [],
        error_message: null,
        warning_message: null,
        completed_at: new Date().toISOString(),
      });
      return;
    }

    const failedPages = failures.map((entry) => entry.pageNo);
    const remainingPages = Array.from(
      { length: total },
      (_, index) => index + 1,
    ).filter((value) => !completedPages.includes(value));

    const nextPage =
      failedPages.find((page) => remainingPages.includes(page)) ??
      remainingPages[0];

    const completedLabel =
      successes.length > 1
        ? "Páginas " +
          successes.map((entry) => entry.pageNo).join(" e ") +
          " concluídas"
        : successes.length === 1
          ? "Página " + successes[0].pageNo + " concluída"
          : "Tentativa concluída";

    await updateJob(jobId, {
      status: "processing",
      progress_current: completedPages.length,
      progress_total: total,
      progress_label:
        completedLabel +
        " · " +
        offers.length +
        " ofertas acumuladas. Continuando…",
      retailer,
      valid_from: validFrom,
      valid_to: validTo,
      result,
      error_message: null,
      warning_message: failures.length
        ? "Uma página demorou a responder e será tentada novamente automaticamente."
        : null,
      completed_at: null,
    });

    if (nextPage) await triggerPage(jobId, nextPage);
  } catch (error) {
    console.error("process-flyer-job page batch", requestedPage, error);

    const currentJob = await fetchJob(jobId).catch(() => null);
    const total = Math.max(
      1,
      Math.trunc(Number(currentJob?.page_count) || 1),
    );
    const processedPages = Array.isArray(currentJob?.result?.processed_pages)
      ? currentJob.result.processed_pages
          .map((value: unknown) => Math.trunc(Number(value) || 0))
          .filter((value: number) => value >= 1 && value <= total)
      : [];

    await updateJob(jobId, {
      status: "failed",
      progress_current: processedPages.length,
      progress_total: total,
      progress_label:
        "A importação foi interrompida. O progresso anterior foi preservado.",
      error_message:
        error instanceof Error
          ? error.message
          : "Falha inesperada ao processar estas páginas.",
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

    // Multi-image flyers process up to two independent physical pages in
    // parallel per invocation. PDFs remain page-by-page.
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
