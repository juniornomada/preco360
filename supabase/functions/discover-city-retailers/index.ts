import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;

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

const knownNetworks: Array<[RegExp, string]> = [
  [/\batacadao\b/i, "Atacadão"],
  [/\bassai\b/i, "Assaí"],
  [/\bmax atacadista\b/i, "Max Atacadista"],
  [/\btenda atacado\b/i, "Tenda Atacado"],
  [/\btauste\b/i, "Tauste"],
  [/\bconfianca(?: max| supermercados?)?\b/i, "Confiança"],
  [/\bsp(?:a|ani) atacadista\b/i, "Spani Atacadista"],
  [/\broldao\b/i, "Roldão Atacadista"],
  [/\bcarrefour\b/i, "Carrefour"],
  [/\bsam s club\b/i, "Sam's Club"],
  [/\bsuper muffato\b|\bmuffato\b/i, "Super Muffato"],
  [/\bcondor\b/i, "Condor"],
  [/\bfort atacadista\b/i, "Fort Atacadista"],
  [/\bkomprao\b/i, "Komprão Koch Atacadista"],
  [/\bkoch\b/i, "Supermercados Koch"],
  [/\bgiassi\b/i, "Giassi"],
  [/\bangeloni\b/i, "Angeloni"],
  [/\bzaffari\b/i, "Zaffari"],
  [/\bbourbon\b/i, "Bourbon"],
  [/\bsupermercados bh\b|\bbh supermercado\b/i, "Supermercados BH"],
  [/\bmart minas\b/i, "Mart Minas"],
  [/\bapoio mineiro\b/i, "Apoio Mineiro"],
  [/\bvillefort\b/i, "Villefort"],
  [/\bsupernosso\b/i, "Supernosso"],
  [/\bepa supermercado\b|\bepa supermercados\b/i, "EPA"],
  [/\bsavegnago\b/i, "Savegnago"],
  [/\bpao de acucar\b/i, "Pão de Açúcar"],
  [/\bpague menos\b/i, "Supermercados Pague Menos"],
  [/\bhiga\b/i, "Higa Atacado"],
  [/\bcoop\b/i, "Coop"],
  [/\bsao vicente\b/i, "São Vicente"],
  [/\bbarbosa\b/i, "Barbosa Supermercados"],
  [/\bbom lugar\b/i, "Bom Lugar Supermercados"],
  [/\bcomercial esperanca\b|\besperanca\b/i, "Comercial Esperança"],
];

function canonicalRetailer(displayName: string, cityName: string) {
  const clean = displayName.replace(/\s+/g, " ").trim();
  const normalized = normalize(clean);

  for (const [pattern, canonical] of knownNetworks) {
    if (pattern.test(normalized)) return { name: canonical, known: true };
  }

  const city = normalize(cityName);
  let generic = normalized
    .replace(new RegExp(`\\b${city.replace(/\s+/g, "\\s+")}\\b`, "g"), " ")
    .replace(/\b(loja|unidade|filial|hipermercado|supermercado|supermercados|atacado|atacadista)\s*(\d+)?\b/g, " ")
    .replace(/\b(centro|norte|sul|leste|oeste)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (generic.length < 3) generic = normalized;
  const words = generic.split(" ").filter(Boolean).slice(0, 4);
  const title = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return { name: title || clean, known: false };
}

function slugifyCity(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&atilde;/gi, "ã")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú");
}

function tiendeoDocumentLines(document: string) {
  let value = String(document ?? "");

  if (/<(?:html|body|main|section|article|div|li|p|h[1-6]|script)\b/i.test(value)) {
    value = value
      .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
      .replace(/<\/?(?:main|section|article|div|li|ul|ol|p|h[1-6]|br|tr|td|th)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
  }

  return decodeHtmlEntities(value)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
        .replace(/^\s*[-*•]+\s*/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Bolean);
}

function tiendeoRetailerFromLine(line: string, cityName: string) {
  const compact = String(line ?? "")
    .replace(/\[(5.*?)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*•]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) return null;

  const known = canonicalRetailer(compact, cityName);
  if (known.known) return known.name;

  const addressStart = compact.search(
    /(?:Avenida|Av\.?|Rua|R\.?|Rodovia|Rod\.?|Estrada|Praça|Pç\.?|Alameda|Travessa|BR[-\s]?\d|R:)/i,
  );

  let candidate = addressStart > 0 ? compact.slice(0, addressStart).trim() : "";

  if (!candidate) {
    const cityIndex = normalize(compact).indexOf(normalize(cityName));
    const distanceMatch = compact.match(/\b\d+(?:[.,]\d+)?\s*(?:m|km)\b/i);
    const cutoff = distanceMatch?.index ?? (cityIndex > 0 ? cityIndex : -1);
    if (cutoff > 0) {
      const beforeLocation = compact.slice(0, cutoff).trim();
      const commaIndex = beforeLocation.indexOf(",");
      if (commaIndex > 2) candidate = beforeLocation.slice(0, commaIndex).trim();
    }
  }

  candidate = candidate
    .replace(/\b(?:Aberto|Fechado|Fecha em breve)\b.*$/i, "")
    .replace(/\s+(?:loja|unidade|filial)\s*\d*$/i, "")
    .replace(/[,:;\-]+$/g, "")
    .trim();

  if (candidate.length < 2 || candidate.length > 80) return null;

  const genericNoise =
    /^(?:publicidade|ver mais|mapa|supermercados|catálogos?|folhetos?|ofertas?|promoções?)$/i;
  if (genericNoise.test(candidate)) return null;

  return canonicalRetailer(candidate, cityName).name;
}

function parseTiendeoNearbyStores(document: string, city: any) {
  const lines = tiendeoDocumentLines(document);
  const cityName = String(city?.name ?? "").trim();
  const cityNorm = normalize(cityName);
  if (!cityNorm) return [];

  const headingIndex = lines.findIndex((line) => {
    const n = normalize(line);
    return (
      n.includes("lojas mais proximas") &&
      n.includes("supermercados")
    ) || (
      n.includes("lojas proximas") &&
      n.includes("supermercados")
    );
  });

  const sectionStart = headingIndex >= 0 ? headingIndex + 1 : 0;
  let sectionEnd = lines.length;

  if (headingIndex >= 0) {
    for (let i = sectionStart; i < lines.length; i += 1) {
      const n = normalize(lines[i]);
      if (
        n.includes("folhetos e melhores ofertas") ||
        n.includes("supermercados em outras cidades") ||
        n.includes("outros negocios")
      ) {
        sectionEnd = i;
        break;
      }
    }
  }

  const places: any[] = [];
  const seenPlaceKeys = new Set<string>();

  const addCandidate = (raw: string, index: number) => {
    const compact = raw.replace(/\s+/g, " ").trim();
    const compactNorm = normalize(compact);
    if (!compact || !compactNorm.includes(cityNorm)) return;

    const hasAddress =
      /(?:Avenida|Av\.?|Rua|R\.?|Rodovia|Rod\.?|Estrada|Praça|Pç\.?|Alameda|Travessa|BR[-\s]?\d)/i.test(compact) ||
      /\b\d+(?:[.,]\d+)?\s*(?:m|km)\b/i.test(compact);
    if (!hasAddress) return;

    const retailer = tiendeoRetailerFromLine(compact, cityName);
    if (!retailer) return;

    const placeKey = `${normalize(retailer)}|${compactNorm}`;
    if (seenPlaceKeys.has(placeKey)) return;
    seenPlaceKeys.add(placeKey);

    places.push({
      id: `tiendeo:${slugifyCity(cityName)}:${normalize(retailer)}:${places.length + 1}`,
      displayName: { text: retailer },
      formattedAddress: compact,
      types: ["supermarket"],
      businessStatus: "OPERATIONAL",
      _rankScore: Math.max(1, 100 - index),
    });
  };

  for (let i = sectionStart; i < sectionEnd; i += 1) {
    addCandidate(lines[i], i);
    if (i > sectionStart) addCandidate(`${lines[i - 1]} ${lines[i]}`, i);
    if (i + 1 < sectionEnd) addCandidate(`${lines[i]} ${lines[i + 1]}`, i);
  }

  if (!places.length && headingIndex < 0) {
    for (let i = 0; i < lines.length; i += 1) {
      addCandidate(lines[i], i);
      if (i > 0) addCandidate(`${lines[i - 1]} ${lines[i]}`, i);
      if (i + 1 < lines.length) addCandidate(`${lines[i]} ${lines[i + 1]}`, i);
    }
  }

  return places;
}

async function tiendeoSearch(city: any) {
  const slug = slugifyCity(city?.name);
  if (!slug) return { available: false, places: [] as any[], url: null };

  const tiendeoUrl = `https://www.tiendeo.com.br/${slug}/supermercados`;
  const browserHeaders = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "pt-BR,pt;q=0.9,en;q=0.7",
    "user-agent":
      "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36",
  };

  const sources = [
    {
      name: "tiendeo-direct",
      url: tiendeoUrl,
      init: { headers: browserHeaders } as RequestInit,
      timeoutMs: 8000,
    },
    {
      name: "jina-https",
      url: `https://r.jina.ai/${tiendeoUrl}`,
      init: {
        headers: {
          accept: "text/plain",
          "x-return-format": "markdown",
        },
      } as RequestInit,
      timeoutMs: 10000,
    },
    {
      name: "jina-http",
      url: `https://r.jina.ai/http://www.tiendeo.com.br/${slug}/supermercados`,
      init: {
        headers: {
          accept: "text/plain",
          "x-return-format": "markdown",
        },
      } as RequestInit,
      timeoutMs: 10000,
    },
  ];

  let providerAvailable = false;
  const failures: string[] = [];

  for (const source of sources) {
    try {
      const document = await fetchTextWithTimeout(
        source.url,
        source.init,
        source.timeoutMs,
      );

      const pageLooksValid =
        /Tiendeo/i.test(document) ||
        /Supermercados em/i.test(document) ||
        /lojas.{0,40}Supermercados/i.test(document);

      if (!pageLooksValid) {
        failures.push(`${source.name}:TIENDEO_PAGE_INVALID`);
        continue;
      }

      providerAvailable = true;
      const places = parseTiendeoNearbyStores(document, city);

      console.log("tiendeo_retailer_discovery", {
        city: city?.name,
        state: city?.state,
        url: tiendeoUrl,
        source: source.name,
        document_chars: document.length,
        places: places.length,
      });

      if (places.length > 0) {
        return {
          available: true,
          places,
          url: tiendeoUrl,
          source: source.name,
        };
      }
    } catch (error) {
      failures.push(
        `${source.name}:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.warn("Tiendeo retailer discovery returned no stores", {
    city: city?.name,
    state: city?.state,
    url: tiendeoUrl,
    provider_available: providerAvaile,
    failures,
  });

  return {
    available: providerAvaile,
    places: [] as any[],
    url: tiendeoUrl,
    source: null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json(503, { error: "SERVER_CONFIG_MISSING" });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "UNAUTHORIZED" });

  const auth = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return json(401, { error: "UNAUTHORIZED" });

  const body = await req.json().catch(() => ({}));
  const cityId = String(body?.city_id ?? "").trim();
  const force = body?.force === true;
  if (!cityId) return json(400, { error: "CITY_ID_REQUIRED" });

  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: city, error: cityError } = await db
      .from("cities")
      .select("id,name,state")
      .eq("id", cityId)
      .eq("active", true)
      .single();

    if (cityError || !city) return json(404, { error: "CITY_NOT_FOUND" });

    const { data: cachedRows, error: cacheError } = await db
      .from("retailer_city_availability")
      .select("retailer,status,source_count,location_count,relevance_score,discovery_source,last_checked_at")
      .eq("city_id", cityId)
      .order("relevance_score", { ascending: false, nullsFirst: false });

    if (cacheError) throw cacheError;

    const discoveryCached = (cachedRows ?? []).filter((row: any) => {
      if (row.discovery_source !== "tiendeo" || !row.last_checked_at) return false;
      const age = Date.now() - new Date(row.last_checked_at).getTime();
      return Number.isFinite(age) && age >= 0 && age < CACHE_MS;
    });

    if (!force && discoveryCached.length > 0) {
      return json(200, {
        ok: true,
        cached: true,
        city,
        provider: "tiendeo",
        networks: discoveryCached,
      });
    }

    const seenPlaces = new Map<string, any>();
    const tiendeo = await tiendeoSearch(city);

    for (const place of tiendeo.places) {
      seenPlaces.set(place.id, place);
    }

    const discoverySource = "tiendeo";
    const providerFailure = tiendeo.available ? null : "tiendeo_unavailable";

    console.log("city_retailer_discovery_result", {
      city: city.name,
      state: city.state,
      provider: discoverySource,
      raw_places: seenPlaces.size,
    });

    if (!seenPlaces.size) {
      return json(200, {
        ok: true,
        cached: false,
        city,
        provider: discoverySource,
        provider_available: tiendeo.available,
        provider_failure: providerFailure,
        raw_places: 0,
        networks: [],
        warning: tiendeo.available
          ? "O Tiendeo não listou nenhuma rede de supermercado para esta cidade."
          : "Não foi possível consultar o Tiendeo para esta cidade agora.",
      });
    }

    const grouped = new Map<string, {
      retailer: string;
      known: boolean;
      places: any[];
      score: number;
    }>();

    for (const place of seenPlaces.values()) {
      const displayName = String(place?.displayName?.text ?? "").trim();
      if (!displayName) continue;
      const canonical = canonicalRetailer(displayName, city.name);
      const key = normalize(canonical.name);
      if (!key) continue;

      const current = grouped.get(key) ?? {
        retailer: canonical.name,
        known: canonical.known,
        places: [],
        score: 0,
      };
      current.places.push(place);
      current.known = current.known || canonical.known;
      current.score += Number(place._rankScore ?? 0);
      grouped.set(key, current);
    }

    const ranked = [...grouped.values()]
      .map((group) => ({
        ...group,
        score:
          group.score +
          Math.min(12, Math.max(0, group.places.length - 1) * 4) +
          (group.known ? 4 : 0),
      }))
      .sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.0001) return b.score - a.score;
        if (b.places.length !== a.places.length) return b.places.length - a.places.length;
        return a.retailer.localeCompare(b.retailer, "pt-BR");
      });

    const now = new Date().toISOString();
    const existing = new Map(
      (cachedRows ?? []).map((row: any) => [normalize(row.retailer), row]),
    );

    for (const group of ranked) {
      const old = existing.get(normalize(group.retailer));
      const { error } = await db.from("retailer_city_availability").upsert(
        {
          city_id: cityId,
          retailer: group.retailer,
          status: old?.status === "available" ? "available" : "discovered",
          source_count: Number(old?.source_count ?? 0),
          location_count: group.places.length,
          relevance_score: group.score,
          discovery_source: discoverySource,
          external_place_ids: group.places.map((place) => place.id),
          last_checked_at: now,
          discovered_at: old?.discovered_at ?? now,
          notes:
            old?.status === "available"
              ? old?.notes ?? null
              : `Descoberta automática via Tiendeo em ${city.name} - ${city.state}.`,
        },
        { onConflict: "retailer,city_id" },
      );
      if (error) throw error;
    }

    const selectedKeys = new Set(ranked.map((group) => normalize(group.retailer)));
    for (const row of cachedRows ?? []) {
      if (
        row.status === "discovered" &&
        row.discovery_source !== "manual" &&
        !selectedKeys.has(normalize(row.retailer))
      ) {
        await db
          .from("retailer_city_availability")
          .delete()
          .eq("city_id", cityId)
          .eq("retailer", row.retailer)
          .eq("status", "discovered");
      }
    }

    const { data: finalRows, error: finalError } = await db
      .from("retailer_city_availability")
      .select("retailer,status,source_count,location_count,relevance_score,discovery_source,last_checked_at")
      .eq("city_id", cityId)
      .eq("discovery_source", "tiendeo")
      .order("relevance_score", { ascending: false, nullsFirst: false });

    if (finalError) throw finalError;

    return json(200, {
      ok: true,
      cached: false,
      city,
      provider: discoverySource,
      provider_available: true,
      raw_places: seenPlaces.size,
      networks: finalRows ?? [],
    });
  } catch (error) {
    console.error("discover-city-retailers", error);
    return json(500, {
      error: "DISCOVERY_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
