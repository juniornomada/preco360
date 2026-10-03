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
  [/\bpague menos\b/i, "Supermercados Pague Menos"],
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

async function googleSearch(apiKey: string, query: string, pageToken?: string | null) {
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "pt-BR",
    regionCode: "BR",
    pageSize: 20,
    rankPreference: "RELEVANCE",
  };
  if (pageToken) body.pageToken = pageToken;

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.types,places.businessStatus,nextPageToken",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(payload?.error?.message || payload?.message || `Google Places HTTP ${response.status}`),
    );
  }
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
      .select("id,name,state,population,population_reference_year,retailer_target_count")
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

    const googleCached = (cachedRows ?? []).filter((row: any) => {
      if (row.discovery_source !== "google_places" || !row.last_checked_at) return false;
      const age = Date.now() - new Date(row.last_checked_at).getTime();
      return Number.isFinite(age) && age >= 0 && age < CACHE_MS;
    });

    if (!force && googleCached.length >= Math.min(4, target)) {
      return json(200, {
        ok: true,
        cached: true,
        city,
        target,
        networks: (cachedRows ?? []).slice(0, target),
      });
    }

    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
    if (!apiKey) {
      return json(503, {
        error: "GOOGLE_PLACES_API_KEY_MISSING",
        message: "Configure GOOGLE_PLACES_API_KEY no Supabase para ativar a descoberta automática.",
        city,
        target,
        networks: (cachedRows ?? []).slice(0, target),
      });
    }

    const queries = [
      `supermercados e atacarejos em ${city.name} ${city.state}, Brasil`,
      `atacadistas e hipermercados em ${city.name} ${city.state}, Brasil`,
    ];

    const seenPlaces = new Map<string, any>();
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
          discovery_source: "google_places",
          external_place_ids: group.places.map((place) => place.id),
          last_checked_at: now,
          discovered_at: old?.discovered_at ?? now,
          notes:
            old?.status === "available"
              ? old?.notes ?? null
              : `Descoberta automática via Google Places em ${city.name} - ${city.state}.`,
        },
        { onConflict: "retailer,city_id" },
      );
      if (error) throw error;
    }

    const selectedKeys = new Set(ranked.map((group) => normalize(group.retailer)));
    for (const row of cachedRows ?? []) {
      if (
        row.discovery_source === "google_places" &&
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
