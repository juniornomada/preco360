import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OfferRow = {
  id: string;
  flyer_id: string;
  user_id: string;
  raw_name: string;
  brand: string | null;
  package_quantity: number | string | null;
  package_unit: string | null;
  image_url: string | null;
  image_source: string | null;
  image_confidence: number | string | null;
  image_match_status: string | null;
  image_query: string | null;
};

type Candidate = {
  source: "open_food_facts" | "google";
  imageUrl: string;
  title: string;
  brandText: string;
  quantityText: string;
  code?: string;
  deterministicScore: number;
  brandScore: number;
  nameScore: number;
  packageScore: number;
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

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([a-z])\.([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const aliases: Record<string, string> = {
  bisc: "biscoito",
  biscoitos: "biscoito",
  achoc: "achocolatado",
  ref: "refrigerante",
  refr: "refrigerante",
  qj: "queijo",
  qjo: "queijo",
  muss: "mussarela",
  fgo: "frango",
  ferm: "fermento",
  mant: "manteiga",
  desinf: "desinfetante",
};

const stop = new Set([
  "de","da","do","das","dos","e","ou","com","sem","tipo","tipos","sabor","sabores",
  "pacote","embalagem","caixa","garrafa","lata","latas","sache","saches","pote","frasco",
  "un","und","unid","unidade","unidades","kg","g","ml","l","lt",
  "resfriado","congelado","fat","fatiado","granel","leve","pague",
]);

function tokens(value: unknown) {
  return normalize(value)
    .split(/\s+/)
    .map((token) => aliases[token] ?? token)
    .filter((token) => token && !stop.has(token) && !/^\d+(?:[.,]\d+)?$/.test(token));
}

function meaningfulBrandTokens(value: unknown) {
  return tokens(value).filter((token) => token.length >= 2);
}

function packageBase(quantity: unknown, unit: unknown) {
  const q = Number(quantity);
  const u = normalize(unit);
  if (!Number.isFinite(q) || q <= 0 || !u) return null;
  if (u === "g") return { unit: "kg", value: q / 1000 };
  if (u === "kg") return { unit: "kg", value: q };
  if (u === "ml") return { unit: "l", value: q / 1000 };
  if (u === "l" || u === "lt") return { unit: "l", value: q };
  return null;
}

function parseQuantity(value: unknown) {
  const raw = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  const multipack = raw.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lt)\b/);
  if (multipack) {
    const count = Number(multipack[1]);
    const each = Number(multipack[2]);
    return packageBase(count * each, multipack[3]);
  }

  const match = raw.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lt)\b/);
  if (!match) return null;
  return packageBase(Number(match[1]), match[2]);
}

function overlapScore(a: string[], b: string[]) {
  if (!a.length || !b.length) return { intersection: 0, containment: 0, jaccard: 0 };
  const A = new Set(a);
  const B = new Set(b);
  const intersection = [...A].filter((token) => B.has(token)).length;
  const union = new Set([...A, ...B]).size;
  return {
    intersection,
    containment: intersection / Math.min(A.size, B.size),
    jaccard: intersection / Math.max(1, union),
  };
}

function brandSimilarity(item: OfferRow, candidateBrand: string, candidateTitle: string) {
  const expected = meaningfulBrandTokens(item.brand);
  if (!expected.length) return 0.5;

  const haystack = new Set(tokens(`${candidateBrand} ${candidateTitle}`));
  const matched = expected.filter((token) => haystack.has(token)).length;
  return matched / expected.length;
}

function packageSimilarity(item: OfferRow, candidateQuantity: string) {
  const expected = packageBase(item.package_quantity, item.package_unit);
  if (!expected) return 0.5;
  const candidate = parseQuantity(candidateQuantity);
  if (!candidate || expected.unit !== candidate.unit) return 0;

  const ratio = Math.min(expected.value, candidate.value) / Math.max(expected.value, candidate.value);
  if (ratio >= 0.97) return 1;
  if (ratio >= 0.9) return 0.72;
  if (ratio >= 0.8) return 0.35;
  return 0;
}

function nameSimilarity(item: OfferRow, candidateTitle: string, candidateBrand = "") {
  const brandTokens = new Set(meaningfulBrandTokens(item.brand));
  const expected = tokens(item.raw_name).filter((token) => !brandTokens.has(token));
  const actual = tokens(`${candidateTitle} ${candidateBrand}`);
  const overlap = overlapScore(expected, actual);
  if (!expected.length) return overlap.containment;
  return overlap.containment * 0.65 + overlap.jaccard * 0.35;
}

function offerLooksFreshOrBulk(item: OfferRow) {
  const text = normalize(item.raw_name);
  return (
    /\b(cenoura|beterraba|abobora|repolho|berinjela|cebola|chuchu|maca|manga|maracuja|tangerina|uva|banana|tomate|limao|laranja|melao|melancia|batata doce|mandioca|bovino|bovina|carne|lagarto|acem|coxao|ponta de peito|costela|frango|suino|pernil|paleta)\b/.test(text) &&
    /\bkg\b/.test(text)
  );
}

function offerLooksNonFood(item: OfferRow) {
  const text = normalize(item.raw_name);
  return /\b(vaso|papel higienico|shampoo|condicionador|creme dental|escova dental|antisseptico|detergente|lava louca|desinfetante|sabao|amaciante|filme pvc|papel aluminio|saco para alimento|fralda|absorvente|limpeza|desodorante|sabonete|protetor solar|inseticida)\b/.test(text);
}

function offerIsAmbiguousMultiProduct(item: OfferRow) {
  const text = normalize(item.raw_name);
  const hasOr = /\bou\b/.test(text);
  const hasDifferentWeights = (text.match(/\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l)\b/g) ?? []).length >= 2;
  return hasOr && hasDifferentWeights;
}

function buildSearchQuery(item: OfferRow) {
  const raw = normalize(item.raw_name)
    .replace(/\b(tipos?|sabores?|unidade|unidades|leve|pague)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const brand = normalize(item.brand);
  const packageText =
    item.package_quantity && item.package_unit
      ? `${item.package_quantity}${String(item.package_unit).toLowerCase()}`
      : "";

  const parts = [brand, raw, packageText].filter(Boolean);
  return [...new Set(parts)].join(" ").trim();
}

function scoreOffHit(item: OfferRow, hit: any): Candidate | null {
  const imageUrl = hit?.image_front_small_url || hit?.image_front_url;
  if (!imageUrl) return null;

  const brands = Array.isArray(hit?.brands) ? hit.brands.join(" ") : String(hit?.brands ?? "");
  const title = String(hit?.product_name ?? "");
  const quantity = String(hit?.quantity ?? "");

  const brandScore = brandSimilarity(item, brands, title);
  const packageScore = packageSimilarity(item, quantity);
  const nameScore = nameSimilarity(item, title, brands);

  // For branded packaged goods, wrong brand or wrong size is an immediate rejection.
  if (item.brand && brandScore < 0.99) return null;
  if (packageBase(item.package_quantity, item.package_unit) && packageScore < 0.72) return null;

  // Require real semantic overlap; package+brand alone is not enough (e.g. two unrelated 350ml beers).
  if (nameScore < 0.34) return null;

  const countries = Array.isArray(hit?.countries_tags) ? hit.countries_tags.join(" ") : "";
  const brazilBonus = /brazil|brasil/i.test(countries) ? 0.04 : 0;

  const deterministicScore =
    Math.min(1, brandScore) * 0.42 +
    Math.min(1, packageScore) * 0.36 +
    Math.min(1, nameScore) * 0.22 +
    brazilBonus;

  return {
    source: "open_food_facts",
    imageUrl: String(imageUrl),
    title,
    brandText: brands,
    quantityText: quantity,
    code: String(hit?.code ?? ""),
    deterministicScore,
    brandScore,
    nameScore,
    packageScore,
  };
}

async function searchOpenFoodFacts(item: OfferRow, query: string) {
  const response = await fetch("https://search.openfoodfacts.org/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)",
    },
    body: JSON.stringify({
      q: query,
      fields: [
        "code",
        "product_name",
        "brands",
        "quantity",
        "countries_tags",
        "image_front_small_url",
        "image_front_url",
      ],
      page_size: 10,
      page: 1,
      boost_phrase: true,
      langs: ["pt", "en"],
    }),
  });

  if (!response.ok) return [] as Candidate[];
  const payload = await response.json().catch(() => null);
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  return hits
    .map((hit: any) => scoreOffHit(item, hit))
    .filter((entry: Candidate | null): entry is Candidate => !!entry)
    .sort((a, b) => b.deterministicScore - a.deterministicScore);
}

async function searchGoogleImages(item: OfferRow, query: string) {
  const key = Deno.env.get("GOOGLE_CSE_API_KEY") || "";
  const cx = Deno.env.get("GOOGLE_CSE_CX") || "";
  if (!key || !cx) return [] as Candidate[];

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", `${query} produto embalagem`);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", "5");
  url.searchParams.set("safe", "active");
  url.searchParams.set("gl", "br");
  url.searchParams.set("lr", "lang_pt");

  const response = await fetch(url);
  if (!response.ok) return [] as Candidate[];
  const payload = await response.json().catch(() => null);
  const items = Array.isArray(payload?.items) ? payload.items : [];

  return items
    .map((hit: any) => {
      const title = String(hit?.title ?? "");
      const brandScore = brandSimilarity(item, title, title);
      const nameScore = nameSimilarity(item, title, title);
      const packageScore = parseQuantity(title)
        ? packageSimilarity(item, title)
        : 0.5;

      if (item.brand && brandScore < 0.99) return null;
      if (nameScore < 0.42) return null;

      return {
        source: "google" as const,
        imageUrl: String(hit?.link ?? ""),
        title,
        brandText: title,
        quantityText: title,
        deterministicScore:
          Math.min(1, brandScore) * 0.45 +
          Math.min(1, packageScore) * 0.25 +
          Math.min(1, nameScore) * 0.3,
        brandScore,
        nameScore,
        packageScore,
      };
    })
    .filter((entry: Candidate | null): entry is Candidate => !!entry?.imageUrl)
    .sort((a, b) => b.deterministicScore - a.deterministicScore);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function verifyCandidateWithGemini(item: OfferRow, candidate: Candidate) {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!apiKey) return { match: false, confidence: 0 };

  let imageResponse: Response;
  try {
    imageResponse = await fetch(candidate.imageUrl, {
      headers: { "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { match: false, confidence: 0 };
  }
  if (!imageResponse.ok) return { match: false, confidence: 0 };

  const contentType = imageResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!contentType.startsWith("image/")) return { match: false, confidence: 0 };
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 2_500_000) return { match: false, confidence: 0 };

  const prompt = `
Você está validando a foto de uma oferta de supermercado no Brasil.
Oferta alvo:
- nome: ${item.raw_name}
- marca esperada: ${item.brand ?? "não informada"}
- embalagem esperada: ${item.package_quantity ?? "?"} ${item.package_unit ?? ""}
Candidato:
- título/origem: ${candidate.title}
- quantidade catalogada: ${candidate.quantityText || "não informada"}

Analise a embalagem visível na imagem. Aceite somente se for claramente a mesma marca e a mesma linha/tipo de produto, e a quantidade/volume for compatível com a oferta. Para ofertas "tipos", o sabor pode variar, mas marca, linha, categoria e tamanho devem continuar compatíveis. Rejeite se houver dúvida, marca diferente, produto diferente, tamanho incompatível, foto genérica, logotipo isolado ou imagem que não mostre o produto.

Retorne SOMENTE JSON válido:
{"match":true,"confidence":0.98}
`;

  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: contentType, data: bytesToBase64(bytes) } },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 128,
      temperature: 0,
    },
  };

  for (const model of ["gemini-3.5-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash-lite"]) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) continue;
    const payload = await response.json().catch(() => null);
    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text ?? "")
      .join("")
      .trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      return {
        match: parsed?.match === true,
        confidence: Math.max(0, Math.min(1, Number(parsed?.confidence) || 0)),
      };
    } catch {
      continue;
    }
  }

  return { match: false, confidence: 0 };
}

async function resolveImage(item: OfferRow) {
  const query = buildSearchQuery(item);

  if (offerLooksFreshOrBulk(item) || offerIsAmbiguousMultiProduct(item)) {
    return { query, candidate: null as Candidate | null, confidence: 0, status: "fallback" };
  }

  // Open Food Facts is excellent for packaged food/beverages. Never use it for unrelated
  // household/personal-care categories; those need Google CSE or a category fallback.
  let candidates: Candidate[] = [];
  if (!offerLooksNonFood(item)) {
    candidates = await searchOpenFoodFacts(item, query);
  }

  let best = candidates[0] ?? null;

  // Optional Google Programmable Search fallback. It is only active when the project has
  // GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX configured; every Google candidate is vision-verified.
  if (!best || best.deterministicScore < 0.9) {
    const google = await searchGoogleImages(item, query);
    if (google[0] && (!best || google[0].deterministicScore > best.deterministicScore)) {
      best = google[0];
    }
  }

  if (!best) {
    return { query, candidate: null, confidence: 0, status: "fallback" };
  }

  // Very strong catalog matches can be accepted deterministically. Everything else must
  // survive a second-stage visual verification before it is shown to the user.
  if (
    best.source === "open_food_facts" &&
    best.deterministicScore >= 0.94 &&
    best.brandScore >= 0.99 &&
    best.packageScore >= 0.97 &&
    best.nameScore >= 0.5
  ) {
    return {
      query,
      candidate: best,
      confidence: Math.min(1, best.deterministicScore),
      status: "verified",
    };
  }

  if (best.deterministicScore < 0.78) {
    return { query, candidate: null, confidence: best.deterministicScore, status: "rejected" };
  }

  const visual = await verifyCandidateWithGemini(item, best);
  if (!visual.match || visual.confidence < 0.9) {
    return {
      query,
      candidate: null,
      confidence: Math.max(best.deterministicScore, visual.confidence),
      status: "rejected",
    };
  }

  return {
    query,
    candidate: best,
    confidence: Math.min(1, (best.deterministicScore + visual.confidence) / 2),
    status: "verified",
  };
}

async function triggerNext(flyerId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;

  await fetch(url + "/functions/v1/resolve-flyer-images", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ flyer_id: flyerId, internal: true }),
  }).catch(() => {});
}

async function processBatch(flyerId: string) {
  const supabase = serviceClient();

  const { data: rows, error } = await supabase
    .from("flyer_items")
    .select("id,flyer_id,user_id,raw_name,brand,package_quantity,package_unit,image_url,image_source,image_confidence,image_match_status,image_query")
    .eq("flyer_id", flyerId)
    .is("image_match_status", null)
    .order("source_page", { ascending: true })
    .limit(8);

  if (error) throw error;
  const items = (rows ?? []) as OfferRow[];
  if (!items.length) return;

  for (const item of items) {
    try {
      const resolved = await resolveImage(item);
      if (resolved.candidate) {
        await supabase
          .from("flyer_items")
          .update({
            image_url: resolved.candidate.imageUrl,
            image_source:
              resolved.candidate.source === "google"
                ? "google_cse_v1"
                : `open_food_facts_v3:${resolved.candidate.code || "matched"}`,
            image_confidence: resolved.confidence,
            image_match_status: resolved.status,
            image_query: resolved.query,
          })
          .eq("id", item.id);
      } else {
        await supabase
          .from("flyer_items")
          .update({
            image_url: null,
            image_source: "category_fallback",
            image_confidence: resolved.confidence,
            image_match_status: resolved.status === "rejected" ? "rejected" : "fallback",
            image_query: resolved.query,
          })
          .eq("id", item.id);
      }
    } catch (error) {
      console.warn("resolve-flyer-images failed", item.id, error);
      await supabase
        .from("flyer_items")
        .update({
          image_url: null,
          image_source: "category_fallback",
          image_confidence: 0,
          image_match_status: "fallback",
          image_query: buildSearchQuery(item),
        })
        .eq("id", item.id);
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const { count } = await supabase
    .from("flyer_items")
    .select("id", { count: "exact", head: true })
    .eq("flyer_id", flyerId)
    .is("image_match_status", null);

  if ((count ?? 0) > 0) {
    await triggerNext(flyerId);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const body = await req.json();
    const flyerId = String(body?.flyer_id ?? "").trim();
    if (!flyerId) return json(400, { error: "FLYER_ID_REQUIRED" });

    const caller = await callerIdentity(req);
    const supabase = serviceClient();
    const { data: flyer, error } = await supabase
      .from("flyers")
      .select("id,user_id")
      .eq("id", flyerId)
      .single();
    if (error || !flyer) return json(404, { error: "FLYER_NOT_FOUND" });

    const isOwner = !!caller.userId && caller.userId === flyer.user_id;
    if (!caller.isService && !isOwner) return json(403, { error: "FORBIDDEN" });

    EdgeRuntime.waitUntil(processBatch(flyerId));
    return json(202, { ok: true, flyer_id: flyerId, status: "resolving" });
  } catch (error) {
    console.error("resolve-flyer-images", error);
    return json(500, {
      error: "IMAGE_RESOLUTION_FAILED",
      message: error instanceof Error ? error.message : "Falha ao buscar imagens.",
    });
  }
});
