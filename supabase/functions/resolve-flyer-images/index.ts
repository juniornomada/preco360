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
  product_id: string | null;
  raw_name: string;
  brand: string | null;
  package_quantity: number | string | null;
  package_unit: string | null;
  image_url: string | null;
  image_source: string | null;
  image_confidence: number | string | null;
  image_match_status: string | null;
  image_query: string | null;
  category?: string | null;
};

type Candidate = {
  source: "open_food_facts" | "open_products_facts" | "open_beauty_facts" | "google";
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

type LibraryImage = {
  id: string;
  product_id: string | null;
  product_key: string;
  normalized_name: string;
  brand: string | null;
  package_quantity: number | string | null;
  package_unit: string | null;
  category: string | null;
  image_url: string;
  image_source: string;
  external_code: string | null;
  confidence: number | string;
  status: string;
  search_query: string | null;
};

type LibraryMatch = {
  row: LibraryImage;
  familyReuse: boolean;
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
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
    .replace(/\s+/g, " ")
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

function semanticFamily(value: unknown) {
  const text = normalize(value);

  const rules: Array<[string, RegExp]> = [
    ["protein_bar", /barra de proteina|barra de prot\b|protein bar/],
    ["supplement", /\bwhey\b|creatina|suplemento/],
    ["yogurt", /iog\s*liq|iogurte|probio2/],
    ["mouthwash", /listerine|antisseptico bucal/],
    ["fish", /merluza|tilapia|bacalhau|pintado|salmao|sardinha|peixe/],
    ["shrimp", /camarao/],
    ["paper_towel", /papel toalha|toalha de papel/],
    ["toilet_paper", /papel higienico|papel hig\b/],
    ["soda", /refrigerante|sukita|guarana|fanta|sprite/],
    ["milk_drink", /bebida lactea|composto lacteo/],
    ["wine", /vinho|frisante|espumante/],
    ["beer", /cerveja|\bcerv\b/],
    ["spirits", /smirnoff ice|cachaca|caipirinha|\bgin\b|licor|coquetel|aperitivo|campari|aperol/],
    ["juice", /suco|refresco|nectar/],
    ["chocolate_drink", /achocolatado|toddynho/],
    // Type wins over flavor: café sabor chocolate stays coffee.
    ["coffee", /cafe|cappuccino|dolce gusto|capsula/],
    ["tea", /\bcha\b/],
    ["biscuit", /biscoito|\bbisc\b|cookie|bolacha|wafer|rosquinha|torrada|polvilho/],
    ["candy", /bala|gelatina|bombom|confeito|goma de mascar|torrone/],
    ["chocolate", /chocolate|nutella|creme de avela/],
    ["rice", /arroz/],
    ["beans", /feijao/],
    ["flour", /farinha|fuba|flocao|tapioca/],
    ["olive_oil", /azeite|oleo/],
    ["pasta", /macarrao|lasanha|nhoque|massa/],
    ["bread", /pao/],
    ["pizza", /pizza/],
    ["sushi", /temaki|sushi|\bmaki\b/],
    ["sandwich", /sanduiche/],
    ["dessert", /mousse|pudim|sobremesa|sorvete|torta|panettone|waffle/],
    ["ketchup", /ketchup/],
    ["mustard", /mostarda/],
    ["tomato_sauce", /molho (?:de )?tomate|extrato (?:de )?tomate/],
    ["mayonnaise", /maionese/],
    ["peas", /ervilha/],
    ["bacon", /bacon/],
    ["sausage", /linguica|salsicha|calabresa/],
    ["chicken", /frango|sobrecoxa|\bcoxa\b|coxinha|\basa\b/],
    ["beef", /contra file|coxao|patinho|acem|osso buco|carne moida|bovino|bovina|lagarto/],
    ["pork", /costela suina|costelinha suina|bisteca suina|panceta suina|pernil|lombo/],
    ["cold_cuts", /mortadela|presunto|salame/],
    ["butter", /manteiga|margarina/],
    ["cheese", /queijo|cream cheese|requeijao|ricota|quark/],
    ["milk", /\bleite\b/],
    ["egg", /\bovos?\b/],
    ["corn", /milho/],
    ["tomato", /tomate/],
    ["fruit", /uva|manga|banana|abacaxi|caju|melao|melancia|maca|pera|laranja|tangerina|maracuja|goiaba|mirtilo|mamao/],
    ["cleaning", /deterg|desengordurante|limpador|desinfetante|sabao|amaciante|tira manchas|agua sanitaria|cloro/],
    ["personal_care", /shampoo|condicionador|sabonete|desodorante|protetor solar|hidratante|tintura/],
  ];

  for (const [family, pattern] of rules) {
    if (pattern.test(text)) return family;
  }
  return null;
}

function semanticCompatible(expected: unknown, candidate: unknown) {
  const expectedFamily = semanticFamily(expected);
  const candidateFamily = semanticFamily(candidate);
  return !expectedFamily || !candidateFamily || expectedFamily === candidateFamily;
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

  const multi = raw.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lt)\b/);
  if (multi) return packageBase(Number(multi[1]) * Number(multi[2]), multi[3]);

  const match = raw.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lt)\b/);
  return match ? packageBase(Number(match[1]), match[2]) : null;
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
  return expected.filter((token) => haystack.has(token)).length / expected.length;
}

function packageSimilarity(item: OfferRow, candidateQuantity: string) {
  const expected = packageBase(item.package_quantity, item.package_unit);
  if (!expected) return 0.5;
  const candidate = parseQuantity(candidateQuantity);
  if (!candidate || expected.unit !== candidate.unit) return 0;

  const ratio = Math.min(expected.value, candidate.value) /
    Math.max(expected.value, candidate.value);
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

function normalizedPackageKey(item: OfferRow) {
  const pkg = packageBase(item.package_quantity, item.package_unit);
  if (!pkg) {
    const q = Number(item.package_quantity);
    const unit = normalize(item.package_unit);
    return Number.isFinite(q) && q > 0 && unit ? `${q}:${unit}` : "";
  }
  return `${pkg.value.toFixed(4)}:${pkg.unit}`;
}

function canonicalName(item: OfferRow) {
  const brandSet = new Set(meaningfulBrandTokens(item.brand));
  return tokens(item.raw_name)
    .filter((token) => !brandSet.has(token))
    .join(" ")
    .trim();
}

function productKey(item: OfferRow) {
  const core = canonicalName(item) || normalize(item.raw_name);
  const brand = normalize(item.brand);
  const pkg = normalizedPackageKey(item);
  return item.product_id
    ? `product:${item.product_id}|${pkg}`
    : `name:${core}|brand:${brand}|pkg:${pkg}`;
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

  return [...new Set([brand, raw, packageText].filter(Boolean))].join(" ").trim();
}

function preferPermanentVisualFallback(item: OfferRow) {
  const text = normalize(item.raw_name);
  return /barra de proteina|protein bar|dolce gusto|toddynho|listerine|antisseptico bucal|probio2|file de merluza|merluza|papel toalha|refrigerante|sukita|farinha de trigo|ketchup|molho barbecue|barbecue|molho de tomate|extrato de tomate|batata doce rosada|ervilhas? finas|jardineira de legumes|bacon|jerked beef|carne seca|charque|linguica calabresa|calabresa defumada|costela suina|uva verde|\bcaju\b|\bmelao\b|mousse de chocolate/.test(text);
}

function offerLooksFreshOrBulk(item: OfferRow) {
  const text = normalize(item.raw_name);
  return (
    /\b(cenoura|beterraba|abobora|repolho|berinjela|cebola|chuchu|maca|manga|maracuja|tangerina|uva|banana|tomate|limao|laranja|melao|melancia|batata doce|mandioca|bovino|bovina|carne|lagarto|acem|coxao|ponta de peito|costela|frango|suino|pernil|paleta)\b/.test(text) &&
    (/\bkg\b/.test(text) || !item.brand)
  );
}

function offerLooksNonFood(item: OfferRow) {
  const text = normalize(item.raw_name);
  return /\b(vaso|papel higienico|shampoo|condicionador|creme dental|escova dental|antisseptico|detergente|lava louca|desinfetante|sabao|amaciante|filme pvc|papel aluminio|saco para alimento|fralda|absorvente|limpeza|desodorante|sabonete|protetor solar|inseticida)\b/.test(text);
}

function offerIsAmbiguousMultiProduct(item: OfferRow) {
  const text = normalize(item.raw_name);
  const hasOr = /\bou\b/.test(text);
  const weights = text.match(/\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l)\b/g) ?? [];
  return hasOr && weights.length >= 2;
}

function cacheScore(item: OfferRow, cached: LibraryImage) {
  if (!semanticCompatible(item.raw_name, cached.normalized_name)) return 0;

  if (item.product_id && cached.product_id === item.product_id) {
    const pkg = packageSimilarity(item, `${cached.package_quantity ?? ""}${cached.package_unit ?? ""}`);
    if (pkg >= 0.72 || !packageBase(item.package_quantity, item.package_unit)) {
      return 1.05;
    }
  }

  const expectedBrand = normalize(item.brand);
  const cachedBrand = normalize(cached.brand);
  if (expectedBrand && cachedBrand && expectedBrand !== cachedBrand) return 0;

  const expectedPkg = packageBase(item.package_quantity, item.package_unit);
  const cachedPkg = packageBase(cached.package_quantity, cached.package_unit);
  if (expectedPkg && cachedPkg) {
    if (expectedPkg.unit !== cachedPkg.unit) return 0;
    const ratio = Math.min(expectedPkg.value, cachedPkg.value) /
      Math.max(expectedPkg.value, cachedPkg.value);
    if (ratio < 0.9) return 0;
  }

  const name = overlapScore(
    tokens(canonicalName(item) || item.raw_name),
    tokens(cached.normalized_name),
  );
  const brandBonus = expectedBrand && cachedBrand ? 0.08 : 0;
  const pkgBonus = expectedPkg && cachedPkg ? 0.12 : 0;
  return name.containment * 0.55 + name.jaccard * 0.25 + brandBonus + pkgBonus;
}

async function findLibraryImage(
  supabase: ReturnType<typeof serviceClient>,
  item: OfferRow,
): Promise<LibraryMatch | null> {
  const key = productKey(item);

  const { data: exact } = await supabase
    .from("product_images")
    .select("*")
    .eq("user_id", item.user_id)
    .eq("product_key", key)
    .maybeSingle();

  if (
    exact?.image_url &&
    Number(exact.confidence) >= 0.85 &&
    semanticCompatible(item.raw_name, exact.normalized_name)
  ) {
    return { row: exact as LibraryImage, familyReuse: false };
  }

  const { data: rows } = await supabase
    .from("product_images")
    .select("*")
    .eq("user_id", item.user_id)
    .gte("confidence", 0.85)
    .order("updated_at", { ascending: false })
    .limit(160);

  const libraryRows = (rows ?? []) as LibraryImage[];

  const ranked = libraryRows
    .map((row) => ({ row, score: cacheScore(item, row) }))
    .filter((entry) => entry.score >= 0.74)
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.row) {
    return { row: ranked[0].row, familyReuse: false };
  }

  // If the exact package is not in the library, reuse a verified image from the
  // same brand + semantic product family. This is intentionally less strict on
  // package size, but never crosses product families (e.g. Nescau cereal cannot
  // inherit the image of Nescau achocolatado).
  const expectedBrand = normalize(item.brand);
  const expectedFamily = semanticFamily(item.raw_name);

  if (expectedBrand && expectedFamily) {
    const familyMatches = libraryRows
      .filter((row) =>
        !!row.image_url &&
        Number(row.confidence) >= 0.9 &&
        normalize(row.brand) === expectedBrand &&
        semanticFamily(row.normalized_name) === expectedFamily
      )
      .map((row) => {
        const overlap = overlapScore(
          tokens(canonicalName(item) || item.raw_name),
          tokens(row.normalized_name),
        );
        return {
          row,
          score: overlap.containment * 0.7 + overlap.jaccard * 0.3,
        };
      })
      .filter((entry) => entry.score >= 0.34)
      .sort((a, b) => b.score - a.score);

    if (familyMatches[0]?.row) {
      return { row: familyMatches[0].row, familyReuse: true };
    }
  }

  return null;
}

function scoreOffHit(item: OfferRow, hit: any): Candidate | null {
  const imageUrl = hit?.image_front_small_url || hit?.image_front_url;
  if (!imageUrl) return null;

  const brands = Array.isArray(hit?.brands) ? hit.brands.join(" ") : String(hit?.brands ?? "");
  const title = String(hit?.product_name ?? "");
  const quantity = String(hit?.quantity ?? "");

  if (!semanticCompatible(item.raw_name, title)) return null;

  const brandScore = brandSimilarity(item, brands, title);
  const packageScore = packageSimilarity(item, quantity);
  const nameScore = nameSimilarity(item, title, brands);
  const expectedPackage = packageBase(item.package_quantity, item.package_unit);
  const candidatePackage = parseQuantity(quantity);

  if (item.brand && brandScore < 0.99) return null;
  // Missing quantity metadata is not a rejection by itself: the visual verifier can
  // still confirm the package. A conflicting explicit quantity is rejected.
  if (expectedPackage && candidatePackage && packageScore < 0.72) return null;
  if (nameScore < 0.34) return null;

  const countries = Array.isArray(hit?.countries_tags) ? hit.countries_tags.join(" ") : "";
  const brazilBonus = /brazil|brasil/i.test(countries) ? 0.04 : 0;

  const deterministicScore = Math.min(
    1,
    Math.min(1, brandScore) * 0.42 +
      Math.min(1, packageScore) * 0.36 +
      Math.min(1, nameScore) * 0.22 +
      brazilBonus,
  );

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

function searchQueryVariants(item: OfferRow, original: string) {
  const brand = normalize(item.brand);
  const core = canonicalName(item);
  const packageText =
    item.package_quantity && item.package_unit
      ? `${item.package_quantity}${String(item.package_unit).toLowerCase()}`
      : "";

  return [...new Set([
    original,
    [brand, core, packageText].filter(Boolean).join(" "),
    [brand, core].filter(Boolean).join(" "),
  ].map((value) => value.trim()).filter(Boolean))];
}

async function searchOpenFoodFacts(item: OfferRow, query: string) {
  const found = new Map<string, Candidate>();

  for (const variant of searchQueryVariants(item, query)) {
    const response = await fetch("https://search.openfoodfacts.org/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)",
      },
      body: JSON.stringify({
        q: variant,
        fields: [
          "code","product_name","brands","quantity","countries_tags",
          "image_front_small_url","image_front_url",
        ],
        page_size: 12,
        page: 1,
        boost_phrase: true,
        langs: ["pt", "en"],
      }),
      signal: AbortSignal.timeout(12000),
    }).catch(() => null);

    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    const hits = Array.isArray(payload?.hits) ? payload.hits : [];
    for (const hit of hits) {
      const scored = scoreOffHit(item, hit);
      if (!scored) continue;
      const key = scored.code || scored.imageUrl;
      const previous = found.get(key);
      if (!previous || scored.deterministicScore > previous.deterministicScore) {
        found.set(key, scored);
      }
    }
    if (found.size >= 5) break;
  }

  // Search-a-licious is preferred. The legacy full-text endpoint is a fallback for
  // Brazilian products that are harder to retrieve by the newer search index.
  if (!found.size) {
    const legacy = await searchLegacyCatalog(
      "world.openfoodfacts.org",
      item,
      query,
      "open_food_facts",
    );
    for (const candidate of legacy) found.set(candidate.code || candidate.imageUrl, candidate);
  }

  return [...found.values()].sort(
    (a, b) => b.deterministicScore - a.deterministicScore,
  );
}

async function searchLegacyCatalog(
  domain: string,
  item: OfferRow,
  query: string,
  source: "open_food_facts" | "open_products_facts" | "open_beauty_facts",
) {
  const url = new URL(`https://${domain}/cgi/search.pl`);
  url.searchParams.set("search_terms", searchQueryVariants(item, query)[1] || query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "12");
  url.searchParams.set(
    "fields",
    "code,product_name,brands,quantity,countries_tags,image_front_small_url,image_front_url",
  );

  const response = await fetch(url, {
    headers: { "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)" },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!response?.ok) return [] as Candidate[];

  const payload = await response.json().catch(() => null);
  const products = Array.isArray(payload?.products) ? payload.products : [];
  return products
    .map((hit: any) => {
      const scored = scoreOffHit(item, hit);
      return scored ? { ...scored, source } : null;
    })
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

  const response = await fetch(url, { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!response?.ok) return [] as Candidate[];

  const payload = await response.json().catch(() => null);
  const hits = Array.isArray(payload?.items) ? payload.items : [];

  return hits
    .map((hit: any) => {
      const title = String(hit?.title ?? "");
      if (!semanticCompatible(item.raw_name, title)) return null;
      const brandScore = brandSimilarity(item, title, title);
      const nameScore = nameSimilarity(item, title, title);
      const packageScore = parseQuantity(title) ? packageSimilarity(item, title) : 0.5;

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
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function verifyCandidateWithGemini(item: OfferRow, candidate: Candidate) {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!apiKey) return { match: false, confidence: 0 };

  const response = await fetch(candidate.imageUrl, {
    headers: { "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response?.ok) return { match: false, confidence: 0 };

  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!contentType.startsWith("image/")) return { match: false, confidence: 0 };
  const bytes = new Uint8Array(await response.arrayBuffer());
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

Aceite somente se a imagem mostrar claramente o mesmo produto/linha, marca compatível e embalagem/tamanho compatível. Para ofertas "tipos", o sabor pode variar, mas marca, linha, categoria e tamanho devem continuar compatíveis. Rejeite marca diferente, produto diferente, tamanho incompatível, foto genérica, montagem, logotipo isolado ou imagem que não mostre a embalagem.

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

  for (const model of ["gemini-3.5-flash-lite","gemini-3-flash-preview","gemini-2.5-flash-lite"]) {
    const check = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      },
    ).catch(() => null);
    if (!check?.ok) continue;

    const payload = await check.json().catch(() => null);
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

async function resolveExternal(item: OfferRow, query: string) {
  if (offerLooksFreshOrBulk(item) || offerIsAmbiguousMultiProduct(item)) {
    return { candidate: null as Candidate | null, confidence: 0, status: "fallback" };
  }

  let candidates: Candidate[] = [];
  if (!offerLooksNonFood(item)) {
    candidates = await searchOpenFoodFacts(item, query);
  } else {
    const text = normalize(item.raw_name);
    const beautyLike =
      /\b(shampoo|condicionador|creme dental|escova dental|desodorante|sabonete|protetor solar|absorvente)\b/.test(text);
    candidates = beautyLike
      ? await searchLegacyCatalog(
          "world.openbeautyfacts.org",
          item,
          query,
          "open_beauty_facts",
        )
      : await searchLegacyCatalog(
          "world.openproductsfacts.org",
          item,
          query,
          "open_products_facts",
        );
  }

  let best = candidates[0] ?? null;
  if (!best || best.deterministicScore < 0.9) {
    const google = await searchGoogleImages(item, query);
    if (google[0] && (!best || google[0].deterministicScore > best.deterministicScore)) {
      best = google[0];
    }
  }

  if (!best) return { candidate: null, confidence: 0, status: "fallback" };

  if (
    best.source !== "google" &&
    best.deterministicScore >= 0.94 &&
    best.brandScore >= 0.99 &&
    best.packageScore >= 0.97 &&
    best.nameScore >= 0.5
  ) {
    return { candidate: best, confidence: best.deterministicScore, status: "verified" };
  }

  if (best.deterministicScore < 0.78) {
    return { candidate: null, confidence: best.deterministicScore, status: "rejected" };
  }

  const visual = await verifyCandidateWithGemini(item, best);
  if (!visual.match || visual.confidence < 0.9) {
    return {
      candidate: null,
      confidence: Math.max(best.deterministicScore, visual.confidence),
      status: "rejected",
    };
  }

  return {
    candidate: best,
    confidence: Math.min(1, (best.deterministicScore + visual.confidence) / 2),
    status: "verified",
  };
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extensionFor(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

async function persistCandidateImage(
  supabase: ReturnType<typeof serviceClient>,
  item: OfferRow,
  candidate: Candidate,
  confidence: number,
  query: string,
) {
  const response = await fetch(candidate.imageUrl, {
    headers: { "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)" },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response?.ok) throw new Error("Não foi possível copiar a imagem validada.");

  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!["image/jpeg","image/png","image/webp"].includes(contentType)) {
    throw new Error("Formato de imagem não suportado.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 5_000_000) {
    throw new Error("Imagem vazia ou grande demais.");
  }

  const key = productKey(item);
  const hash = await sha256Hex(key);
  const storagePath = `${item.user_id}/${hash}.${extensionFor(contentType)}`;

  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(storagePath, bytes, {
      contentType,
      cacheControl: "31536000",
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const { data: publicUrl } = supabase.storage
    .from("product-images")
    .getPublicUrl(storagePath);

  const imageUrl = publicUrl.publicUrl;
  const normalizedName = canonicalName(item) || normalize(item.raw_name);

  const { error: libraryError } = await supabase
    .from("product_images")
    .upsert({
      user_id: item.user_id,
      product_id: item.product_id,
      product_key: key,
      normalized_name: normalizedName,
      brand: item.brand,
      package_quantity: item.package_quantity,
      package_unit: item.package_unit,
      category: item.category ?? null,
      image_url: imageUrl,
      image_source: candidate.source,
      external_code: candidate.code || null,
      confidence,
      status: "verified",
      search_query: query,
      storage_path: storagePath,
      source_url: candidate.imageUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,product_key" });
  if (libraryError) throw libraryError;

  if (item.product_id) {
    await supabase
      .from("products")
      .update({
        image_url: imageUrl,
        image_source: "product_library",
      })
      .eq("id", item.product_id)
      .or("image_source.is.null,image_source.eq.product_library");
  }

  return imageUrl;
}

async function applyImage(
  supabase: ReturnType<typeof serviceClient>,
  item: OfferRow,
  values: {
    imageUrl: string | null;
    source: string;
    confidence: number;
    status: string;
    query: string;
  },
) {
  await supabase
    .from("flyer_items")
    .update({
      image_url: values.imageUrl,
      image_source: values.source,
      image_confidence: values.confidence,
      image_match_status: values.status,
      image_query: values.query,
    })
    .eq("id", item.id);
}

async function resolveOne(
  supabase: ReturnType<typeof serviceClient>,
  item: OfferRow,
) {
  const query = buildSearchQuery(item);

  // These families have deterministic product-specific visual rules in the UI.
  // Prefer a known-good icon to a fuzzy catalog image that can misrepresent the item.
  if (preferPermanentVisualFallback(item)) {
    await applyImage(supabase, item, {
      imageUrl: null,
      source: "category_fallback",
      confidence: 1,
      status: "fallback",
      query,
    });
    return;
  }

  const cached = await findLibraryImage(supabase, item);
  if (cached?.row.image_url) {
    await applyImage(supabase, item, {
      imageUrl: cached.row.image_url,
      source: cached.familyReuse ? "product_library_family" : "product_library",
      confidence: cached.familyReuse
        ? Math.min(0.9, Number(cached.row.confidence) || 0.9)
        : Number(cached.row.confidence) || 0.9,
      status: "verified",
      query: cached.familyReuse
        ? "reuso por marca + família: " + buildSearchQuery(item)
        : cached.row.search_query || query,
    });
    return;
  }

  const resolved = await resolveExternal(item, query);
  if (!resolved.candidate) {
    await applyImage(supabase, item, {
      imageUrl: null,
      source: "category_fallback",
      confidence: resolved.confidence,
      status: resolved.status === "rejected" ? "rejected" : "fallback",
      query,
    });
    return;
  }

  const imageUrl = await persistCandidateImage(
    supabase,
    item,
    resolved.candidate,
    resolved.confidence,
    query,
  );

  await applyImage(supabase, item, {
    imageUrl,
    source: "product_library",
    confidence: resolved.confidence,
    status: "verified",
    query,
  });
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
    .select("id,flyer_id,user_id,product_id,raw_name,brand,package_quantity,package_unit,image_url,image_source,image_confidence,image_match_status,image_query")
    .eq("flyer_id", flyerId)
    .is("image_match_status", null)
    .order("source_page", { ascending: true })
    .limit(12);

  if (error) throw error;
  const items = (rows ?? []) as OfferRow[];
  if (!items.length) return;

  const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))];
  const categoryByProduct = new Map<string, string | null>();
  if (productIds.length) {
    const { data: products } = await supabase
      .from("products")
      .select("id,category")
      .in("id", productIds);
    for (const product of products ?? []) {
      categoryByProduct.set(product.id, product.category ?? null);
    }
  }

  const prepared = items.map((item) => ({
    ...item,
    category: item.product_id
      ? categoryByProduct.get(item.product_id) ?? null
      : null,
  }));

  // Resolve a few products concurrently so large flyers do not spend minutes showing
  // placeholders. Keep concurrency modest to respect external catalog rate limits.
  for (let index = 0; index < prepared.length; index += 3) {
    const group = prepared.slice(index, index + 3);
    await Promise.all(
      group.map(async (item) => {
        try {
          await resolveOne(supabase, item);
        } catch (error) {
          console.warn("resolve-flyer-images failed", item.id, error);
          await applyImage(supabase, item, {
            imageUrl: null,
            source: "category_fallback",
            confidence: 0,
            status: "fallback",
            query: buildSearchQuery(item),
          });
        }
      }),
    );
    if (index + 3 < prepared.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const { count } = await supabase
    .from("flyer_items")
    .select("id", { count: "exact", head: true })
    .eq("flyer_id", flyerId)
    .is("image_match_status", null);

  if ((count ?? 0) > 0) await triggerNext(flyerId);
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
