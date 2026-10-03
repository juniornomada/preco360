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

function relevantPlace(place: any) {
  const types = Array.isArray(place?.types) ? place.types : [];
  const allowed = new Set([
    "supermarket",
    "grocery_store",
    "hypermarket",
    "discount_supermarket",
    "warehouse_store",
    "wholesaler",
  ]);
  return types.some((type: string) => allowed.has(type));
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const brazilStateNames: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

async function cityCenter(city: any) {
  const query = encodeURIComponent(String(city?.name ?? ""));
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${query}&count=10&language=pt&format=json&countryCode=BR`;

  const payload = await fetchJsonWithTimeout(
    url,
    {
      headers: {
        accept: "application/json",
      },
    },
    3500,
  );

  const results = Array.isArray(payload?.results) ? payload.results : [];
  const expectedState = normalize(brazilStateNames[String(city?.state ?? "").toUpperCase()] ?? "");
  const expectedCity = normalize(city?.name);

  const match =
    results.find((row: any) =>
      normalize(row?.name) === expectedCity &&
      (!expectedState || normalize(row?.admin1) === expectedState)
    ) ??
    results.find((row: any) => normalize(row?.name) === expectedCity) ??
    results[0];

  const lat = Number(match?.latitude);
  const lon = Number(match?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("CITY_CENTER_NOT_FOUND");
  }

  return {
    lat,
    lon,
    population: Number(match?.population) || null,
  };
}

function osmElementsToPlaces(elements: any[]) {
  return elements
    .map((element: any) => {
      const tags = element?.tags ?? {};
      const displayName = String(tags.brand ?? tags.name ?? "").trim();
      if (!displayName) return null;

      return {
        id: `osm:${element.type}:${element.id}`,
        displayName: { text: displayName },
        formattedAddress: String(tags["addr:street"] ?? ""),
        types: [tags.shop === "wholesale" ? "wholesaler" : "supermarket"],
        businessStatus: "OPERATIONAL",
        _rankScore: 1,
      };
    })
    .filter(Boolean);
}

async function runOverpass(query: string) {
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  const attempts = endpoints.map(async (endpoint) => {
    const payload = await fetchJsonWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "Preco360/1.0 retailer-discovery",
        },
        body: "data=" + encodeURIComponent(query),
      },
      7000,
    );

    const elements = Array.isArray(payload?.elements) ? payload.elements : [];
    const places = osmElementsToPlaces(elements);
    if (!places.length) throw new Error("NO_OSM_RESULTS");
    return places;
  });

  return await Promise.any(attempts);
}

async function openStreetMapAreaSearch(city: any) {
  const ibgeCode = String(city?.ibge_code ?? "").trim();
  if (!/^\d{7}$/.test(ibgeCode)) throw new Error("IBGE_CODE_MISSING");

  const query = `
[out:json][timeout:7];
(
  area["IBGE:GEOCODIGO"="${ibgeCode}"];
  area["ref:IBGE"="${ibgeCode}"];
)->.searchArea;
(
  nwr["shop"="supermarket"](area.searchArea);
  nwr["shop"="wholesale"](area.searchArea);
);
out center tags 120;
`.trim();

  return await runOverpass(query);
}

async function openStreetMapRadiusSearch(city: any) {
  const center = await cityCenter(city);
  const { lat, lon } = center;
  const population = Number(city?.population ?? center.population ?? 0);
  const radius =
    population > 1_500_000 ? 35000 :
    population > 700_000 ? 28000 :
    population > 300_000 ? 22000 :
    population > 100_000 ? 17000 :
    12000;

  const query = `
[out:json][timeout:7];
(
  nwr["shop"="supermarket"](around:${radius},${lat},${lon});
  nwr["shop"="wholesale"](around:${radius},${lat},${lon});
);
out center tags 120;
`.trim();

  return await runOverpass(query);
}

async function openStreetMapSearch(city: any) {
  try {
    return await Promise.any([
      openStreetMapAreaSearch(city),
      openStreetMapRadiusSearch(city),
    ]);
  } catch (error) {
    console.warn("OpenStreetMap retailer discovery failed", {
      city: city?.name,
      state: city?.state,
      ibge_code: city?.ibge_code,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function extractInteractionText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts: string[] = [];
  for (const step of Array.isArray(payload?.steps) ? payload.steps : []) {
    if (step?.type !== "model_output") continue;
    for (const block of Array.isArray(step?.content) ? step.content : []) {
      if (block?.type === "text" && typeof block?.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function parseGroundedRetailerNames(text: string, target: number) {
  if (!text || /^NENHUMA\b/i.test(text.trim())) return [];

  const ignored = /^(nenhuma|não encontrei|nao encontrei|observação|observacao|fonte|fontes)$/i;
  const seen = new Set<string>();
  const names: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine
      .replace(/^\s*[-*•]+\s*/, "")
      .replace(/^\s*\d+[.)-]\s*/, "")
      .replace(/\s*[—–-]\s*(?:possui|tem|loja|lojas|unidade|unidades).*/i, "")
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim();

    if (!line || ignored.test(line)) continue;
    if (line.length > 80) continue;

    const canonical = canonicalRetailer(line, "");
    const name = canonical.name.trim();
    const key = normalize(name);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    names.push(name);
    if (names.length >= target) break;
  }

  return names;
}

async function geminiGroundedRetailerSearch(city: any, target: number) {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!apiKey) return [];

  const prompt = [
    `Pesquise na web quais são as principais redes de supermercados, hipermercados e atacarejos com LOJA FÍSICA em ${city.name} - ${city.state}, Brasil.`,
    `Retorne no máximo ${target} redes distintas.`,
    "Priorize redes com presença relevante na cidade, grandes redes nacionais e redes regionais importantes.",
    "Não inclua restaurantes, shoppings, lojas de conveniência, mercearias pequenas, distribuidores sem varejo, serviços de entrega ou empresas sem loja física comprovada na cidade.",
    "Se houver várias unidades da mesma rede, liste a rede apenas uma vez.",
    "Só inclua uma rede quando a pesquisa na web sustentar que existe loja física nessa cidade.",
    "Responda SOMENTE com os nomes das redes, um por linha, sem numeração, sem explicações e sem URLs.",
    "Se nenhuma rede puder ser confirmada, responda exatamente: NENHUMA",
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: "gemini-3.5-flash-lite",
          input: prompt,
          tools: [{ type: "google_search" }],
        }),
        signal: controller.signal,
      },
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        String(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`),
      );
    }

    return parseGroundedRetailerNames(extractInteractionText(payload), target);
  } catch (error) {
    console.warn("Gemini grounded retailer discovery failed", error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function googleSearch(apiKey: string, query: string, pageToken?: string | null) {
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "pt-BR",
    regionCode: "BR",
    pageSize: 20,
    rankPreference: "RELEVANCE",
  };
  if (pageToken) body.pageToken = pageToken;

  const payload = await fetchJsonWithTimeout(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.types,places.businessStatus,nextPageToken",
      },
      body: JSON.stringify(body),
    },
    6000,
  );
  return payload;
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
      .select("id,name,state,ibge_code,population,population_reference_year,retailer_target_count")
      .eq("id", cityId)
      .eq("active", true)
      .single();

    if (cityError || !city) return json(404, { error: "CITY_NOT_FOUND" });

    const target = Math.max(4, Math.min(8, Number(city.retailer_target_count ?? 5)));

    const { data: cachedRows, error: cacheError } = await db
      .from("retailer_city_availability")
      .select("retailer,status,source_count,location_count,relevance_score,discovery_source,last_checked_at")
      .eq("city_id", cityId)
      .order("relevance_score", { ascending: false, nullsFirst: false });

    if (cacheError) throw cacheError;

    const discoveryCached = (cachedRows ?? []).filter((row: any) => {
      if (!["google_places", "google_search", "openstreetmap"].includes(row.discovery_source) || !row.last_checked_at) return false;
      const age = Date.now() - new Date(row.last_checked_at).getTime();
      return Number.isFinite(age) && age >= 0 && age < CACHE_MS;
    });

    if (!force && discoveryCached.length >= Math.min(4, target)) {
      return json(200, {
        ok: true,
        cached: true,
        city,
        target,
        networks: (cachedRows ?? []).slice(0, target),
      });
    }

    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
    const seenPlaces = new Map<string, any>();
    let discoverySource = "openstreetmap";

    if (apiKey && !seenPlaces.size) {
      const queries = [
        `supermercados e atacarejos em ${city.name} ${city.state}, Brasil`,
        `atacadistas e hipermercados em ${city.name} ${city.state}, Brasil`,
      ];

      try {
        for (let qIndex = 0; qIndex < queries.length; qIndex += 1) {
          const payload = await googleSearch(apiKey, queries[qIndex]);
          const places = Array.isArray(payload?.places) ? payload.places : [];

          for (let rank = 0; rank < places.length; rank += 1) {
            const place = places[rank];
            if (!place?.id || place?.businessStatus === "CLOSED_PERMANENTLY") continue;
            if (!relevantPlace(place)) continue;

            const previous = seenPlaces.get(place.id);
            const score = Math.max(0, 20 - rank) + (qIndex === 0 ? 2 : 0);
            if (!previous || score > previous._rankScore) {
              seenPlaces.set(place.id, { ...place, _rankScore: score });
            }
          }

          if (seenPlaces.size >= target * 2) break;
        }
        if (seenPlaces.size) discoverySource = "google_places";
      } catch (error) {
        console.warn("Google Places retailer discovery failed; using OpenStreetMap fallback", error);
      }
    }

    if (!seenPlaces.size) {
      const osmPlaces = await openStreetMapSearch(city);
      for (const place of osmPlaces) {
        seenPlaces.set(place.id, place);
      }
      discoverySource = "openstreetmap";
    }

    console.log("city_retailer_discovery_result", {
      city: city.name,
      state: city.state,
      target,
      provider: discoverySource,
      raw_places: seenPlaces.size,
    });

    if (!seenPlaces.size) {
      return json(200, {
        ok: true,
        cached: false,
        city,
        target,
        provider: discoverySource,
        raw_places: 0,
        networks: (cachedRows ?? []).slice(0, target),
        warning: "Nenhum supermercado pôde ser descoberto automaticamente agora.",
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
      })
      .slice(0, target);

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
              : `Descoberta automática via ${discoverySource === "google_places" ? "Google Places" : discoverySource === "google_search" ? "Pesquisa Google" : "OpenStreetMap"} em ${city.name} - ${city.state}.`,
        },
        { onConflict: "retailer,city_id" },
      );
      if (error) throw error;
    }

    const selectedKeys = new Set(ranked.map((group) => normalize(group.retailer)));
    for (const row of cachedRows ?? []) {
      if (
        ["google_places", "google_search", "openstreetmap"].includes(row.discovery_source) &&
        row.status === "discovered" &&
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
      .order("relevance_score", { ascending: false, nullsFirst: false })
      .limit(target);

    if (finalError) throw finalError;

    return json(200, {
      ok: true,
      cached: false,
      city,
      target,
      provider: discoverySource,
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
