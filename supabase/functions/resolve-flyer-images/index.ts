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
  "pacote","embalagem","caixa","garrafa","lata","un","und","unid","unidade","kg","g","ml","l",
  "resfriado","congelado","fat","fatiado","granel",
]);

function tokens(value: unknown) {
  return normalize(value)
    .split(/\s+/)
    .map((token) => aliases[token] ?? token)
    .filter((token) => token && !stop.has(token) && !/^\d+(?:[.,]\d+)?$/.test(token));
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
  const text = normalize(value).replace(",", ".");
  const match = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lt)\b/);
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

function shouldUseCategoryFallback(item: OfferRow) {
  const text = normalize(item.raw_name);

  const nonFood =
    /\b(vaso|papel higienico|shampoo|condicionador|creme dental|escova dental|detergente|lava louca|desinfetante|sabao|amaciante|filme pvc|papel aluminio|saco para alimento|fralda|absorvente|limpeza)\b/.test(text);
  if (nonFood) return true;

  const looseFresh =
    /\b(cenoura|beterraba|abobora|repolho|berinjela|cebola|chuchu|maca|manga|maracuja|tangerina|uva|banana|tomate|bovino|bovina|carne|lagarto|acem|coxao|ponta de peito|costela|frango)\b/.test(text) &&
    /\bkg\b/.test(text);
  return looseFresh;
}

function scoreHit(item: OfferRow, hit: any) {
  const imageUrl = hit?.image_front_small_url || hit?.image_front_url;
  if (!imageUrl) return { score: -1, imageUrl: null as string | null };

  const queryTokens = tokens(item.raw_name);
  const brands = Array.isArray(hit?.brands) ? hit.brands.join(" ") : String(hit?.brands ?? "");
  const hitTokens = tokens(`${hit?.product_name ?? ""} ${brands}`);
  const overlap = overlapScore(queryTokens, hitTokens);

  let score = overlap.containment * 0.48 + overlap.jaccard * 0.22;

  const itemBrand = normalize(item.brand);
  const hitBrandText = normalize(brands);
  const productNameText = normalize(hit?.product_name);
  const brandMatch =
    !!itemBrand &&
    (hitBrandText.includes(itemBrand) || productNameText.includes(itemBrand));

  if (brandMatch) score += 0.22;
  else if (itemBrand) score -= 0.08;

  const expected = packageBase(item.package_quantity, item.package_unit);
  const candidate = parseQuantity(hit?.quantity);
  if (expected && candidate) {
    if (expected.unit !== candidate.unit) return { score: -1, imageUrl: null };
    const ratio = Math.min(expected.value, candidate.value) / Math.max(expected.value, candidate.value);
    if (ratio >= 0.95) score += 0.25;
    else if (ratio >= 0.8) score += 0.08;
    else if (ratio < 0.55) score -= 0.25;
  }

  const countries = Array.isArray(hit?.countries_tags) ? hit.countries_tags.join(" ") : "";
  if (/brazil|brasil/i.test(countries)) score += 0.04;

  // One-token matches are accepted only when brand or package evidence is strong.
  if (overlap.intersection < 2 && !brandMatch && !(expected && candidate)) score -= 0.18;

  return { score, imageUrl: String(imageUrl) };
}

async function findImage(item: OfferRow) {
  if (shouldUseCategoryFallback(item)) return null;

  const response = await fetch("https://search.openfoodfacts.org/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)",
    },
    body: JSON.stringify({
      q: item.raw_name,
      fields: [
        "code",
        "product_name",
        "brands",
        "quantity",
        "countries_tags",
        "image_front_small_url",
        "image_front_url",
      ],
      page_size: 6,
      page: 1,
      boost_phrase: true,
      langs: ["pt", "en"],
    }),
  });

  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  if (!hits.length) return null;

  const ranked = hits
    .map((hit: any) => ({ hit, ...scoreHit(item, hit) }))
    .filter((entry: any) => entry.imageUrl)
    .sort((a: any, b: any) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  const minimum = item.brand ? 0.48 : 0.6;
  if (best.score < minimum) return null;

  return {
    imageUrl: best.imageUrl as string,
    score: best.score as number,
    code: String(best.hit?.code ?? ""),
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
    .select("id,flyer_id,user_id,raw_name,brand,package_quantity,package_unit,image_url,image_source")
    .eq("flyer_id", flyerId)
    .is("image_url", null)
    .is("image_source", null)
    .order("source_page", { ascending: true })
    .limit(10);

  if (error) throw error;
  const items = (rows ?? []) as OfferRow[];
  if (!items.length) return;

  for (const item of items) {
    let resolved: Awaited<ReturnType<typeof findImage>> = null;
    try {
      resolved = await findImage(item);
    } catch (error) {
      console.warn("resolve-flyer-images search failed", item.id, error);
    }

    const values = resolved
      ? {
          image_url: resolved.imageUrl,
          image_source: `open_food_facts:${resolved.code || "matched"}:${resolved.score.toFixed(2)}`,
        }
      : {
          image_url: null,
          image_source: "category_fallback",
        };

    await supabase.from("flyer_items").update(values).eq("id", item.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const { count } = await supabase
    .from("flyer_items")
    .select("id", { count: "exact", head: true })
    .eq("flyer_id", flyerId)
    .is("image_url", null)
    .is("image_source", null);

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
