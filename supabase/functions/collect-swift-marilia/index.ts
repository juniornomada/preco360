import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const USER_ID = "e596fdb9-5827-438a-a01a-f452822ad757";
const CITY = "Marília";
const STATE = "SP";
const POSTAL_CODE = "17519000";
const RETAILER = "Swift";
const SOURCE_URL = "https://loja.swift.com.br/";
const UA = "Mozilla/5.0 (compatible; Preco360SwiftBot/1.0; +https://preco360.vercel.app)";

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function todaySP() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizeName(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function packageInfo(name: string, measurementUnit?: unknown) {
  const text = String(name ?? "");
  const skuUnit = String(measurementUnit ?? "").toLowerCase();

  if (/peso\s*vari[aá]vel/i.test(text) || skuUnit === "kg") {
    return {
      package_quantity: null,
      package_unit: null,
      base_unit: "kg",
      factor: 1,
    };
  }

  const trailing = text.match(
    /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lt|un|und|unid)\b(?!.*\d)/i,
  );
  if (!trailing) {
    return {
      package_quantity: null,
      package_unit: null,
      base_unit: null,
      factor: null,
    };
  }

  let quantity = Number(trailing[1].replace(",", "."));
  let unit = trailing[2].toLowerCase();
  if (unit === "lt") unit = "l";
  if (unit === "und" || unit === "unid") unit = "un";

  const leadingCount = text.match(/^\s*(\d{1,3})\s+(?=[A-Za-zÀ-ÿ])/);
  const count = leadingCount ? Number(leadingCount[1]) : 1;
  if (Number.isFinite(count) && count > 1 && count <= 100) {
    quantity *= count;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      package_quantity: null,
      package_unit: null,
      base_unit: null,
      factor: null,
    };
  }

  if (unit === "kg") {
    return { package_quantity: quantity, package_unit: "kg", base_unit: "kg", factor: quantity };
  }
  if (unit === "g") {
    return { package_quantity: quantity, package_unit: "g", base_unit: "kg", factor: quantity / 1000 };
  }
  if (unit === "l") {
    return { package_quantity: quantity, package_unit: "l", base_unit: "l", factor: quantity };
  }
  if (unit === "ml") {
    return { package_quantity: quantity, package_unit: "ml", base_unit: "l", factor: quantity / 1000 };
  }
  if (unit === "un") {
    return { package_quantity: quantity, package_unit: "un", base_unit: "un", factor: quantity };
  }

  return {
    package_quantity: null,
    package_unit: null,
    base_unit: null,
    factor: null,
  };
}

function extractDiscountedOffers(products: any[]) {
  const offers: any[] = [];

  for (const product of products ?? []) {
    const items = Array.isArray(product?.items) ? product.items : [];

    for (const item of items) {
      const sellers = Array.isArray(item?.sellers) ? item.sellers : [];
      let selected: any = null;

      for (const seller of sellers) {
        const offer = seller?.commertialOffer ?? seller?.commercialOffer ?? {};
        const availableQuantity = Number(
          offer?.AvailableQuantity ?? offer?.availableQuantity ?? 0,
        );
        const availability = String(offer?.availability ?? "").toLowerCase();
        if (availableQuantity <= 0 && availability && availability !== "available") {
          continue;
        }

        const price = Number(
          offer?.spotPrice ??
            offer?.Price ??
            offer?.price ??
            offer?.sellingPrice ??
            0,
        );
        const listPrice = Number(
          offer?.ListPrice ??
            offer?.listPrice ??
            offer?.PriceWithoutDiscount ??
            offer?.priceWithoutDiscount ??
            price,
        );

        if (!Number.isFinite(price) || price <= 0) continue;
        if (!Number.isFinite(listPrice) || listPrice <= price + 0.009) continue;

        if (!selected || price < selected.price) {
          selected = { offer, price, listPrice };
        }
      }

      if (!selected) continue;

      const rawName = String(
        item?.nameComplete ??
          item?.name ??
          product?.productName ??
          product?.name ??
          "",
      ).trim();
      if (!rawName) continue;

      const pkg = packageInfo(rawName, item?.measurementUnit);
      const normalizedPrice =
        pkg.factor && pkg.factor > 0 ? selected.price / pkg.factor : null;

      const images = Array.isArray(item?.images) ? item.images : [];
      const imageUrl = String(
        images[0]?.imageUrl ?? images[0]?.url ?? "",
      ).trim() || null;

      const externalId = String(
        item?.itemId ?? item?.id ?? product?.productId ?? rawName,
      );
      const discountPercent = Math.max(
        0,
        Math.round((1 - selected.price / selected.listPrice) * 100),
      );

      offers.push({
        external_id: externalId,
        raw_name: rawName,
        normalized_name: normalizeName(rawName),
        brand: String(product?.brand ?? "").trim() || null,
        package_quantity: pkg.package_quantity,
        package_unit: pkg.package_unit,
        advertised_price: Number(selected.price.toFixed(2)),
        base_unit: pkg.base_unit,
        normalized_price:
          normalizedPrice && Number.isFinite(normalizedPrice)
            ? Number(normalizedPrice.toFixed(4))
            : null,
        image_url: imageUrl,
        offer_notes: [
          "Preço promocional da loja online Swift regionalizado para Marília.",
          "De R$ " +
            selected.listPrice.toFixed(2) +
            " por R$ " +
            selected.price.toFixed(2) +
            (discountPercent > 0 ? " (-" + discountPercent + "%)." : "."),
          "O preço da loja física pode ser diferente.",
        ],
      });
    }
  }

  const unique = new Map<string, any>();
  for (const offer of offers) {
    const key = offer.external_id + "|" + offer.advertised_price;
    if (!unique.has(key)) unique.set(key, offer);
  }
  return [...unique.values()];
}

async function resolveRegionId() {
  const response = await fetch(
    "https://loja.swift.com.br/api/checkout/pub/regions?country=BRA&postalCode=" +
      POSTAL_CODE,
    { headers: { accept: "application/json", "user-agent": UA } },
  );

  if (!response.ok) {
    throw new Error("VTEX regions HTTP " + response.status);
  }

  const payload = await response.json();
  const firstRegion = Array.isArray(payload)
    ? payload[0]
    : payload?.regions?.[0] ?? payload;
  const regionId = String(firstRegion?.id ?? firstRegion?.regionId ?? "").trim();

  if (!regionId) throw new Error("VTEX_REGION_NOT_FOUND");
  return regionId;
}

function segmentCookie(regionId: string) {
  return btoa(
    JSON.stringify({
      campaigns: null,
      channel: "1",
      priceTables: null,
      regionId,
      utm_campaign: null,
      utm_source: null,
      utmi_campaign: null,
      currencyCode: "BRL",
      currencySymbol: "R$",
      countryCode: "BRA",
      cultureInfo: "pt-BR",
    }),
  );
}

async function fetchSearchPage(
  regionId: string,
  segment: string,
  page: number,
  preferredMode: string,
) {
  const modes = preferredMode ? [preferredMode] : ["v1", "legacy"];
  let lastError: unknown = null;

  for (const mode of modes) {
    try {
      const base =
        mode === "v1"
          ? "https://loja.swift.com.br/api/intelligent-search/v1/product-search/trade-policy/1"
          : "https://loja.swift.com.br/api/io/_v/api/intelligent-search/product_search/trade-policy/1";

      const params = new URLSearchParams({
        query: "",
        page: String(page),
        count: "50",
        sort: "discount:desc",
        locale: "pt-BR",
        sc: "1",
      });

      if (mode === "v1") {
        params.set("country", "BRA");
        params.set("regionId", regionId);
      }

      const headers: Record<string, string> = {
        accept: "application/json",
        "user-agent": UA,
      };
      if (mode === "legacy") {
        headers.cookie = "vtex_segment=" + segment;
      }

      const response = await fetch(base + "?" + params.toString(), { headers });
      if (!response.ok) {
        throw new Error(mode + " HTTP " + response.status);
      }

      const payload = await response.json();
      if (!Array.isArray(payload?.products)) {
        throw new Error(mode + " RESPONSE_INVALID");
      }

      return { payload, mode };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("SWIFT_SEARCH_FAILED");
}

async function writeRegistry(client: any, values: any) {
  const { data: known } = await client
    .from("flyer_source_registry")
    .select("id")
    .eq("user_id", USER_ID)
    .eq("retailer", RETAILER)
    .eq("city", CITY)
    .eq("source_key", values.source_key)
    .maybeSingle();

  if (known?.id) {
    const { error } = await client
      .from("flyer_source_registry")
      .update(values)
      .eq("id", known.id);
    if (error) throw error;
    return;
  }

  const { error } = await client
    .from("flyer_source_registry")
    .insert({ user_id: USER_ID, retailer: RETAILER, city: CITY, ...values });
  if (error) throw error;
}

async function updateAvailability(
  client: any,
  offerCount: number,
  scannedProducts: number,
  now: string,
) {
  const { data: city } = await client
    .from("cities")
    .select("id")
    .eq("name", CITY)
    .eq("state", STATE)
    .eq("active", true)
    .maybeSingle();

  if (!city?.id) return;

  const { data: existing } = await client
    .from("retailer_city_availability")
    .select("id,discovered_at")
    .eq("retailer", RETAILER)
    .eq("city_id", city.id)
    .maybeSingle();

  const values = {
    retailer: RETAILER,
    city_id: city.id,
    status: "available",
    source_count: offerCount,
    location_count: 1,
    relevance_score: 100,
    discovery_source: "tiendeo",
    last_checked_at: now,
    discovered_at: existing?.discovered_at ?? now,
    notes:
      "Swift Online regionalizada pelo CEP 17519-000 (Marília). " +
      offerCount +
      " ofertas com desconto real encontradas em " +
      scannedProducts +
      " produtos consultados.",
  };

  if (existing?.id) {
    await client
      .from("retailer_city_availability")
      .update(values)
      .eq("id", existing.id);
  } else {
    await client.from("retailer_city_availability").insert(values);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const client = db();
  const today = todaySP();
  const now = new Date().toISOString();

  try {
    const regionId = await resolveRegionId();
    const segment = segmentCookie(regionId);

    let mode = "";
    let scannedProducts = 0;
    let noDiscountPages = 0;
    const collected: any[] = [];

    for (let page = 0; page < 10; page += 1) {
      const result = await fetchSearchPage(regionId, segment, page, mode);
      mode = result.mode;

      const products = result.payload.products;
      scannedProducts += products.length;
      if (!products.length) break;

      const pageOffers = extractDiscountedOffers(products);
      collected.push(...pageOffers);

      if (pageOffers.length) noDiscountPages = 0;
      else noDiscountPages += 1;

      if (products.length < 50 || noDiscountPages >= 2) break;
    }

    const unique = new Map<string, any>();
    for (const offer of collected) {
      const key = offer.external_id + "|" + offer.advertised_price;
      if (!unique.has(key)) unique.set(key, offer);
    }
    const offers = [...unique.values()];

    const fingerprint = await sha256(
      JSON.stringify(
        offers
          .map((offer) => [offer.external_id, offer.advertised_price])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ),
    );

    const { data: existingFlyer } = await client
      .from("flyers")
      .select("id")
      .eq("user_id", USER_ID)
      .eq("retailer", RETAILER)
      .eq("city", CITY)
      .eq("valid_from", today)
      .eq("valid_to", today)
      .maybeSingle();

    let flyerId = String(existingFlyer?.id ?? "");

    if (!flyerId) {
      const { data: flyer, error } = await client
        .from("flyers")
        .insert({
          user_id: USER_ID,
          retailer: RETAILER,
          title: "Swift Online · Marília",
          valid_from: today,
          valid_to: today,
          city: CITY,
          source_type: "app",
          source_file_name: "swift-online-marilia",
          source_file_path: SOURCE_URL,
          file_hash: fingerprint,
          page_count: 1,
        })
        .select("id")
        .single();
      if (error) throw error;
      flyerId = flyer.id;
    } else {
      const { error: clearError } = await client
        .from("flyer_items")
        .delete()
        .eq("flyer_id", flyerId);
      if (clearError) throw clearError;

      const { error: updateError } = await client
        .from("flyers")
        .update({
          title: "Swift Online · Marília",
          source_type: "app",
          source_file_name: "swift-online-marilia",
          source_file_path: SOURCE_URL,
          file_hash: fingerprint,
          page_count: 1,
        })
        .eq("id", flyerId);
      if (updateError) throw updateError;
    }

    if (offers.length) {
      const rows = offers.map((offer) => ({
        flyer_id: flyerId,
        user_id: USER_ID,
        raw_name: offer.raw_name,
        normalized_name: offer.normalized_name,
        brand: offer.brand,
        package_quantity: offer.package_quantity,
        package_unit: offer.package_unit,
        advertised_price: offer.advertised_price,
        base_unit: offer.base_unit,
        normalized_price: offer.normalized_price,
        club_price: false,
        match_type: "unmatched",
        source_page: 1,
        image_url: offer.image_url,
        image_source: offer.image_url ? "swift_online" : null,
        image_match_status: offer.image_url ? "verified" : null,
        offer_notes: offer.offer_notes,
      }));

      for (let index = 0; index < rows.length; index += 100) {
        const { error } = await client
          .from("flyer_items")
          .insert(rows.slice(index, index + 100));
        if (error) throw error;
      }
    }

    const sourceKey = "swift-online:marilia:" + today;
    await writeRegistry(client, {
      source_key: sourceKey,
      source_url: SOURCE_URL,
      source_title: "Swift Online · Marília",
      valid_from: today,
      valid_to: today,
      metadata_fingerprint: regionId + "|" + fingerprint + "|" + mode,
      file_hash: fingerprint,
      last_seen_at: now,
      last_downloaded_at: now,
      last_processed_at: now,
      status: "processed",
      last_error: null,
    });

    await updateAvailability(client, offers.length, scannedProducts, now);

    console.log("swift_marilia_collection", {
      region_id: regionId,
      mode,
      scanned_products: scannedProducts,
      offers: offers.length,
      flyer_id: flyerId,
    });

    return json(200, {
      ok: true,
      city: CITY,
      retailer: RETAILER,
      scope: "online_marilia",
      postal_code: "17519-000",
      region_id: regionId,
      api_mode: mode,
      scanned_products: scannedProducts,
      offers: offers.length,
      valid_from: today,
      valid_to: today,
      flyer_id: flyerId,
      note: "Preços da loja online Swift; a loja física pode praticar valores diferentes.",
    });
  } catch (error) {
    console.error("collect-swift-marilia", error);
    return json(500, {
      error: "SWIFT_COLLECTION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
