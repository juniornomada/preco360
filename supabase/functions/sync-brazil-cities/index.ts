import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stateCode(row: any) {
  return (
    row?.microrregiao?.mesorregiao?.UF?.sigla ??
    row?.["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla ??
    row?.regiao_imediata?.regiao_intermediaria?.UF?.sigla ??
    null
  );
}

function retailerTarget(population: number | null) {
  if (!population || population <= 0) return 5;
  if (population <= 100_000) return 4;
  if (population <= 300_000) return 5;
  if (population <= 700_000) return 6;
  if (population <= 1_500_000) return 7;
  return 8;
}

function sidraMunicipalityCode(row: Record<string, unknown>) {
  const direct = String(row?.D1C ?? "");
  if (/^\d{7}$/.test(direct)) return direct;

  for (const [key, value] of Object.entries(row)) {
    if (!/C$/.test(key)) continue;
    const text = String(value ?? "");
    if (/^\d{7}$/.test(text)) return text;
  }
  return null;
}

async function loadCensusPopulation() {
  const response = await fetch(
    "https://apisidra.ibge.gov.br/values/t/4709/n6/all/v/93/p/2022/f/u",
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`SIDRA population HTTP ${response.status}`);

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length < 5000) {
    throw new Error("SIDRA population response incomplete");
  }

  const map = new Map<string, number>();
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const code = sidraMunicipalityCode(row as Record<string, unknown>);
    if (!code) continue;

    const rawValue = String((row as any).V ?? "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const population = Number(rawValue);
    if (Number.isFinite(population) && population > 0) {
      map.set(code, Math.round(population));
    }
  }

  if (map.size < 5000) {
    throw new Error(`SIDRA population normalized only ${map.size} municipalities`);
  }
  return map;
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

  try {
    const [localitiesResponse, populationResult] = await Promise.all([
      fetch(
        "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome",
        { headers: { accept: "application/json" } },
      ),
      loadCensusPopulation()
        .then((map) => ({ map, error: null as string | null }))
        .catch((error) => ({
          map: new Map<string, number>(),
          error: error instanceof Error ? error.message : String(error),
        })),
    ]);

    if (!localitiesResponse.ok) {
      return json(502, {
        error: "IBGE_REQUEST_FAILED",
        status: localitiesResponse.status,
      });
    }

    const payload = await localitiesResponse.json();
    if (!Array.isArray(payload) || payload.length < 5000) {
      return json(502, { error: "IBGE_RESPONSE_INVALID" });
    }

    const rows = payload
      .map((city: any) => {
        const name = String(city?.nome ?? "").trim();
        const state = String(stateCode(city) ?? "").trim().toUpperCase();
        const ibgeCode = String(city?.id ?? "").trim();
        if (!name || !/^[A-Z]{2}$/.test(state) || !ibgeCode) return null;

        const population = populationResult.map.get(ibgeCode) ?? null;
        return {
          name,
          state,
          ibge_code: ibgeCode,
          search_name: normalizeSearch(name),
          active: true,
          population,
          population_reference_year: population ? 2022 : null,
          retailer_target_count: retailerTarget(population),
        };
      })
      .filter(Boolean);

    if (rows.length < 5000) {
      return json(502, {
        error: "IBGE_NORMALIZATION_INCOMPLETE",
        received: payload.length,
        normalized: rows.length,
      });
    }

    const db = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error } = await db
        .from("cities")
        .upsert(rows.slice(i, i + batchSize), { onConflict: "name,state" });
      if (error) throw error;
    }

    const { count } = await db
      .from("cities")
      .select("id", { count: "exact", head: true })
      .eq("active", true);

    return json(200, {
      ok: true,
      imported: rows.length,
      active_cities: count ?? rows.length,
      population_loaded: populationResult.map.size >= 5000,
      population_reference_year: populationResult.map.size >= 5000 ? 2022 : null,
      population_warning: populationResult.error,
      source: "IBGE",
    });
  } catch (error) {
    console.error("sync-brazil-cities", error);
    return json(500, {
      error: "SYNC_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
