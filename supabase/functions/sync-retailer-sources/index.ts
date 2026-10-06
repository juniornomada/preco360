import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UA =
  "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Mobile Safari/537.36";

const OFFER_WORDS = [
  "oferta",
  "ofertas",
  "encarte",
  "encartes",
  "folheto",
  "folhetos",
  "promocao",
  "promocoes",
  "promo",
  "catalogo",
  "catalogos",
];

const GENERIC_RETAILER_WORDS = new Set([
  "supermercado",
  "supermercados",
  "mercado",
  "mercados",
  "atacadista",
  "atacado",
  "rede",
  "loja",
  "lojas",
]);

const BLOCKED_HOSTS = [
  "tiendeo.",
  "facebook.",
  "instagram.",
  "youtube.",
  "tiktok.",
  "reclameaqui.",
  "google.",
  "bing.",
  "duckduckgo.",
  "ofertasnosupermercado.",
  "guiamais.",
  "apontador.",
  "wikipedia.",
];

const KNOWN: Record<string, any> = {
  atacadao: {
    retailer: "Atacadão",
    official_site_url: "https://www.atacadao.com.br/",
    offers_url: "https://www.atacadao.com.br/loja/marilia",
    source_type: "web",
    collector_key: "Atacadão",
    capture_supported: true,
  },
  "max atacadista": {
    retailer: "Max Atacadista",
    official_site_url: "https://www.maxatacadista.com.br/",
    offers_url: "https://www.maxatacadista.com.br/lojas/",
    source_type: "web",
    collector_key: "Max Atacadista",
    capture_supported: true,
  },
  kawakami: {
    retailer: "Kawakami",
    official_site_url: "https://institucional.kawakami.com.br/",
    offers_url: "https://institucional.kawakami.com.br/oferta/marilia",
    source_type: "web",
    collector_key: "Kawakami",
    capture_supported: true,
  },
  confianca: {
    retailer: "Confiança",
    official_site_url: "https://clienteconfianca.com.br/",
    offers_url: "https://clienteconfianca.com.br/ofertas-marilia.html",
    source_type: "web",
    collector_key: "Confiança",
    capture_supported: true,
  },
  tauste: {
    retailer: "Tauste",
    official_site_url: "https://institucional.tauste.com.br/",
    offers_url: "https://institucional.tauste.com.br/ofertas",
    source_type: "web",
    collector_key: "Tauste",
    capture_supported: true,
  },
  swift: {
    retailer: "Swift",
    official_site_url: "https://loja.swift.com.br/",
    offers_url: "https://loja.swift.com.br/",
    source_type: "api",
    collector_key: "Swift",
    capture_supported: true,
  },
  amigao: {
    retailer: "Amigão",
    official_site_url: "https://institucional.amigao.com/",
    offers_url: "https://institucional.amigao.com/encartes-e-tv/?loja=marilia",
    source_type: "web",
    collector_key: "Amigão",
    capture_supported: false,
  },
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactKey(value: unknown) {
  return normalize(value);
}

function htmlDecode(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function textOnly(value: string) {
  return htmlDecode(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isBlockedHost(url: URL) {
  const host = url.hostname.toLowerCase();
  return BLOCKED_HOSTS.some((blocked) => host.includes(blocked));
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 7000,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: "follow",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/pdf,image/avif,image/webp,image/*,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9",
        "user-agent": UA,
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function retailerTokens(retailer: string) {
  return normalize(retailer)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 && !GENERIC_RETAILER_WORDS.has(token),
    );
}

function retailerMatchScore(retailer: string, value: string) {
  const target = normalize(value);
  const tokens = retailerTokens(retailer);
  if (!tokens.length) return 0;
  return tokens.filter((token) => target.includes(token)).length / tokens.length;
}

function hasOfferWords(value: string) {
  const normalized = normalize(value);
  return OFFER_WORDS.some((word) => normalized.includes(word));
}

function unwrapDuckDuckGo(raw: string) {
  const decoded = htmlDecode(raw);
  try {
    const url = decoded.startsWith("//")
      ? new URL("https:" + decoded)
      : new URL(decoded);
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
  } catch {
    // keep raw value
  }
  return decoded;
}

function parseDuckDuckGo(html: string) {
  const results: Array<{ url: string; title: string }> = [];
  const matches = html.matchAll(
    /<a\b([^>]*class=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/gi,
  );

  for (const match of matches) {
    const attrs = match[1] || "";
    const hrefMatch = attrs.match(/href=['"]([^'"]+)['"]/i);
    if (!hrefMatch) continue;
    const url = unwrapDuckDuckGo(hrefMatch[1]);
    const title = textOnly(match[2] || "");
    if (!url || !title) continue;
    results.push({ url, title });
  }

  return results;
}

async function searchWeb(query: string) {
  const url =
    "https://lite.duckduckgo.com/lite/?kl=br-pt&q=" +
    encodeURIComponent(query);
  const response = await fetchWithTimeout(url, 9000);
  if (!response.ok) {
    throw new Error("SEARCH_HTTP_" + response.status);
  }
  return parseDuckDuckGo(await response.text());
}

function discoverAssets(html: string, baseUrl: string) {
  const assets = new Map<
    string,
    { url: string; type: "pdf" | "image" }
  >();

  const add = (raw: string) => {
    const decoded = htmlDecode(raw).trim();
    if (!decoded || decoded.startsWith("data:")) return;
    let absolute = "";
    try {
      absolute = new URL(decoded, baseUrl).toString();
    } catch {
      return;
    }
    const parsed = safeUrl(absolute);
    if (!parsed || isBlockedHost(parsed)) return;

    const pathname = parsed.pathname.toLowerCase();
    if (/\.pdf$/i.test(pathname)) {
      assets.set(parsed.toString(), { url: parsed.toString(), type: "pdf" });
    } else if (/\.(png|jpe?g|webp)$/i.test(pathname)) {
      assets.set(parsed.toString(), { url: parsed.toString(), type: "image" });
    }
  };

  for (const match of html.matchAll(
    /(?:href|src|data-src|data-lazy-src)=['"]([^'"]+)['"]/gi,
  )) {
    add(match[1]);
  }

  return [...assets.values()].slice(0, 30);
}

function knownSource(retailer: string, cityName: string) {
  const key = compactKey(retailer);
  const source = KNOWN[key];
  if (!source) return null;

  if (normalize(cityName) !== "marilia") {
    return {
      ...source,
      capture_supported: false,
      collector_key: null,
    };
  }

  return source;
}

async function inspectUrl(
  retailer: string,
  cityName: string,
  candidateUrl: string,
  title = "",
) {
  const parsed = safeUrl(candidateUrl);
  if (!parsed || isBlockedHost(parsed)) return null;

  try {
    const response = await fetchWithTimeout(parsed.toString(), 8000);
    const finalUrl = safeUrl(response.url || parsed.toString()) ?? parsed;
    const contentType = String(response.headers.get("content-type") || "")
      .toLowerCase();

    if (!response.ok) {
      return {
        url: finalUrl.toString(),
        title,
        ok: false,
        http_status: response.status,
        retailer_score: retailerMatchScore(
          retailer,
          title + " " + finalUrl.hostname,
        ),
      };
    }

    if (/application\/pdf/i.test(contentType) || /\.pdf$/i.test(finalUrl.pathname)) {
      const cityVerified =
        normalize(title + " " + finalUrl.pathname).includes(normalize(cityName));
      return {
        url: finalUrl.toString(),
        title,
        ok: true,
        http_status: response.status,
        retailer_score: retailerMatchScore(
          retailer,
          title + " " + finalUrl.hostname,
        ),
        city_verified: cityVerified,
        has_offer: true,
        source_type: "pdf",
        assets: [{ url: finalUrl.toString(), type: "pdf" }],
      };
    }

    if (/^image\//i.test(contentType) || /\.(png|jpe?g|webp)$/i.test(finalUrl.pathname)) {
      const cityVerified =
        normalize(title + " " + finalUrl.pathname).includes(normalize(cityName));
      return {
        url: finalUrl.toString(),
        title,
        ok: true,
        http_status: response.status,
        retailer_score: retailerMatchScore(
          retailer,
          title + " " + finalUrl.hostname,
        ),
        city_verified: cityVerified,
        has_offer: true,
        source_type: "image",
        assets: [{ url: finalUrl.toString(), type: "image" }],
      };
    }

    const html = await response.text();
    const plain = textOnly(html).slice(0, 500000);
    const combined = title + " " + finalUrl.toString() + " " + plain;
    const cityVerified = normalize(combined).includes(normalize(cityName));
    const retailerScore = Math.max(
      retailerMatchScore(retailer, finalUrl.hostname),
      retailerMatchScore(retailer, title),
      retailerMatchScore(retailer, plain.slice(0, 20000)),
    );
    const hasOffer = hasOfferWords(
      title + " " + finalUrl.pathname + " " + plain.slice(0, 80000),
    );
    const assets = discoverAssets(html, finalUrl.toString());

    return {
      url: finalUrl.toString(),
      title,
      ok: true,
      http_status: response.status,
      retailer_score: retailerScore,
      city_verified: cityVerified,
      has_offer: hasOffer,
      source_type: assets.length ? assets[0].type : "web_catalog",
      assets,
      plain_preview: plain.slice(0, 500),
    };
  } catch (error) {
    return {
      url: parsed.toString(),
      title,
      ok: false,
      http_status: null,
      retailer_score: retailerMatchScore(
        retailer,
        title + " " + parsed.hostname,
      ),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function candidateScore(
  retailer: string,
  cityName: string,
  result: { url: string; title: string },
) {
  const parsed = safeUrl(result.url);
  if (!parsed || isBlockedHost(parsed)) return -100;

  let score = 0;
  score += retailerMatchScore(
    retailer,
    parsed.hostname + " " + result.title,
  ) * 50;
  if (hasOfferWords(parsed.pathname + " " + result.title)) score += 25;
  if (
    normalize(parsed.pathname + " " + result.title).includes(
      normalize(cityName),
    )
  ) {
    score += 20;
  }
  if (/institucional|oficial/i.test(parsed.hostname + " " + result.title)) {
    score += 4;
  }
  return score;
}

async function syncRetailer(
  retailer: string,
  city: any,
  existing: any,
) {
  const now = new Date().toISOString();
  const known = knownSource(retailer, city.name);

  if (known) {
    const inspection = await inspectUrl(
      retailer,
      city.name,
      known.offers_url,
      retailer + " ofertas " + city.name,
    );

    const ok = Boolean(inspection?.ok);
    const cityVerified =
      normalize(city.name) === "marilia" ||
      Boolean(inspection?.city_verified);
    const available =
      ok &&
      (known.source_type === "api" ||
        Boolean(inspection?.has_offer) ||
        known.capture_supported);

    return {
      retailer: known.retailer || retailer,
      official_site_url: known.official_site_url,
      offers_url: known.offers_url,
      source_type: known.source_type,
      source_status: available
        ? "available"
        : ok
          ? "no_offer"
          : "temporary_error",
      city_verified: cityVerified,
      capture_supported: Boolean(known.capture_supported),
      collector_key: known.collector_key,
      discovery_method: "known_official_source",
      last_http_status: inspection?.http_status ?? null,
      last_sync_at: now,
      last_offer_seen_at: available
        ? now
        : existing?.last_offer_seen_at ?? null,
      last_error: ok
        ? null
        : inspection?.error || "Fonte oficial temporariamente indisponível.",
      metadata: {
        inspected_url: inspection?.url ?? known.offers_url,
        assets: inspection?.assets ?? [],
        page_title: inspection?.title ?? null,
      },
    };
  }

  const searches = [
    '"' + retailer + '" "' + city.name + '" ofertas supermercado',
    '"' + retailer + '" "' + city.name + '" encarte folheto',
  ];

  const merged = new Map<string, { url: string; title: string }>();
  let searchError = "";

  for (const query of searches) {
    try {
      for (const result of await searchWeb(query)) {
        const parsed = safeUrl(result.url);
        if (!parsed || isBlockedHost(parsed)) continue;
        const key = parsed.toString();
        if (!merged.has(key)) merged.set(key, result);
      }
    } catch (error) {
      searchError = error instanceof Error ? error.message : String(error);
    }
  }

  const ranked = [...merged.values()]
    .map((result) => ({
      ...result,
      score: candidateScore(retailer, city.name, result),
    }))
    .filter((result) => result.score >= 15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!ranked.length) {
    return {
      retailer,
      official_site_url: existing?.official_site_url ?? null,
      offers_url: existing?.offers_url ?? null,
      source_type: existing?.source_type ?? null,
      source_status: searchError ? "temporary_error" : "site_not_found",
      city_verified: false,
      capture_supported: false,
      collector_key: null,
      discovery_method: "web_search",
      last_http_status: null,
      last_sync_at: now,
      last_offer_seen_at: existing?.last_offer_seen_at ?? null,
      last_error: searchError || null,
      metadata: { search_results: [] },
    };
  }

  const inspections: any[] = [];
  for (const result of ranked) {
    const inspected = await inspectUrl(
      retailer,
      city.name,
      result.url,
      result.title,
    );
    if (inspected) inspections.push({ ...inspected, score: result.score });
  }

  const credible = inspections.filter(
    (item) => item.ok && item.retailer_score >= 0.5,
  );
  const official = credible[0] ?? null;
  const offers = credible
    .filter((item) => item.has_offer)
    .sort((a, b) => {
      const aCity = a.city_verified ? 1 : 0;
      const bCity = b.city_verified ? 1 : 0;
      const aAsset = a.assets?.length ? 1 : 0;
      const bAsset = b.assets?.length ? 1 : 0;
      return bCity - aCity || bAsset - aAsset || b.score - a.score;
    })[0] ?? null;

  if (!official) {
    const hadHttpFailure = inspections.some((item) => !item.ok);
    return {
      retailer,
      official_site_url: null,
      offers_url: null,
      source_type: null,
      source_status: hadHttpFailure ? "temporary_error" : "site_not_found",
      city_verified: false,
      capture_supported: false,
      collector_key: null,
      discovery_method: "web_search",
      last_http_status: inspections[0]?.http_status ?? null,
      last_sync_at: now,
      last_offer_seen_at: existing?.last_offer_seen_at ?? null,
      last_error: hadHttpFailure
        ? "Os resultados foram encontrados, mas não foi possível validar o site agora."
        : null,
      metadata: {
        search_results: ranked,
        inspected: inspections.slice(0, 6),
      },
    };
  }

  let officialOrigin = official.url;
  try {
    officialOrigin = new URL(official.url).origin + "/";
  } catch {
    // keep exact url
  }

  if (!offers) {
    return {
      retailer,
      official_site_url: officialOrigin,
      offers_url: null,
      source_type: null,
      source_status: "no_offer",
      city_verified: false,
      capture_supported: false,
      collector_key: null,
      discovery_method: "web_search",
      last_http_status: official.http_status ?? null,
      last_sync_at: now,
      last_offer_seen_at: existing?.last_offer_seen_at ?? null,
      last_error: null,
      metadata: {
        search_results: ranked,
        inspected: inspections.slice(0, 6),
      },
    };
  }

  const cityVerified = Boolean(offers.city_verified);
  const assets = Array.isArray(offers.assets) ? offers.assets : [];
  const captureSupported =
    cityVerified &&
    (offers.source_type === "pdf" ||
      offers.source_type === "image" ||
      assets.length > 0);

  return {
    retailer,
    official_site_url: officialOrigin,
    offers_url: offers.url,
    source_type: offers.source_type || "web_catalog",
    source_status: cityVerified ? "available" : "review",
    city_verified: cityVerified,
    capture_supported: captureSupported,
    collector_key: captureSupported ? "generic_asset" : null,
    discovery_method: "web_search",
    last_http_status: offers.http_status ?? null,
    last_sync_at: now,
    last_offer_seen_at: cityVerified
      ? now
      : existing?.last_offer_seen_at ?? null,
    last_error: cityVerified
      ? null
      : "A página de ofertas foi encontrada, mas a cidade ainda não pôde ser confirmada com segurança.",
    metadata: {
      search_results: ranked,
      inspected: inspections.slice(0, 6),
      assets,
      page_title: offers.title ?? null,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("authorization") || "";

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !user) {
    return json(401, { error: "UNAUTHORIZED" });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body
  }

  const cityId = String(body?.city_id || "").trim();
  const requestedRetailer = String(body?.retailer || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cityId) {
    return json(400, { error: "CITY_ID_REQUIRED" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: city, error: cityError } = await admin
    .from("cities")
    .select("id,name,state")
    .eq("id", cityId)
    .eq("active", true)
    .maybeSingle();

  if (cityError || !city) {
    return json(404, { error: "CITY_NOT_FOUND" });
  }

  const retailerMap = new Map<string, string>();

  if (requestedRetailer) {
    retailerMap.set(compactKey(requestedRetailer), requestedRetailer);
  } else {
    const [{ data: manual }, { data: discovered }] = await Promise.all([
      admin
        .from("user_city_retailers")
        .select("retailer")
        .eq("user_id", user.id)
        .eq("city_id", cityId),
      admin
        .from("retailer_city_availability")
        .select("retailer")
        .eq("city_id", cityId)
        .eq("discovery_source", "tiendeo"),
    ]);

    for (const row of [...(manual ?? []), ...(discovered ?? [])]) {
      const retailer = String(row?.retailer || "").trim();
      if (retailer) retailerMap.set(compactKey(retailer), retailer);
    }
  }

  const retailers = [...retailerMap.values()];
  if (!retailers.length) {
    return json(200, {
      ok: true,
      city,
      synced: 0,
      results: [],
      warning: "Nenhuma rede cadastrada para sincronizar.",
    });
  }

  const results: any[] = [];

  for (const retailer of retailers.slice(0, 30)) {
    const retailerKey = compactKey(retailer);

    const { data: existing } = await admin
      .from("user_city_retailer_sources")
      .select("*")
      .eq("user_id", user.id)
      .eq("city_id", cityId)
      .eq("retailer_key", retailerKey)
      .maybeSingle();

    let values: any;
    try {
      values = await syncRetailer(retailer, city, existing);
    } catch (error) {
      values = {
        retailer,
        official_site_url: existing?.official_site_url ?? null,
        offers_url: existing?.offers_url ?? null,
        source_type: existing?.source_type ?? null,
        source_status: "temporary_error",
        city_verified: existing?.city_verified ?? false,
        capture_supported: existing?.capture_supported ?? false,
        collector_key: existing?.collector_key ?? null,
        discovery_method: existing?.discovery_method ?? "web_search",
        last_http_status: null,
        last_sync_at: new Date().toISOString(),
        last_offer_seen_at: existing?.last_offer_seen_at ?? null,
        last_error: error instanceof Error ? error.message : String(error),
        metadata: existing?.metadata ?? {},
      };
    }

    const payload = {
      user_id: user.id,
      city_id: cityId,
      ...values,
    };

    const { error: upsertError } = await admin
      .from("user_city_retailer_sources")
      .upsert(payload, {
        onConflict: "user_id,city_id,retailer_key",
      });

    if (upsertError) {
      results.push({
        retailer,
        source_status: "temporary_error",
        error: upsertError.message,
      });
      continue;
    }

    results.push(values);
  }

  return json(200, {
    ok: true,
    city,
    synced: results.length,
    results,
  });
});
