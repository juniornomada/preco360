import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { processingCompatible } from "../_shared/image-candidate-rules.ts";

const FORCE_TARGET_IDS = new Set<string>(["a7cfb220-ab11-42b0-a861-fd9e9acc0507","2d2e1fc6-2259-4d24-bb42-451ed75b7df5","eb150e98-6f87-4175-85a4-35ae838ce207","e51eec9c-503d-4d4d-9eb4-8c367d4423af","53711fd3-f850-4825-a5ce-49593823ad9c","964c0a01-cc2a-41ac-96b5-9bf8e8331af2","f03acf46-0572-4a08-81b7-cef3e30eda6f","a3957742-a986-453b-86c7-0ef0c70eba35","15a2529c-7d9d-4757-a6a4-c16ce1f3b055","43526874-2121-47cd-b19b-d3143e4fcda3","4f5fb764-2532-4f84-8431-53d354fe0783","19a3a93c-73b3-428e-b2ba-c8400d70352a","d109b06d-efbb-4bde-b239-98012e527c80","65508f9f-8acf-47d0-b704-21e94f29b1e0","c3e759d6-0b93-4471-bb11-ee1206f129dc","f85121e3-ae06-4d5d-aa61-32a3f471d3cd","ea9039d5-65d8-4eb9-97ef-9c60ee275d30","f607437d-c5af-452f-b91b-7c1527c489c8","3b2a21e6-9092-47d4-af2b-8d5e7a3b3af0","67cbbfa6-a276-47b8-b7ff-a7ba4ea5124c","d8c8eb7f-2db4-4772-806d-dd35c26c6793","874bcfc5-a59f-499e-a6c6-9d72a3fe7eab","0dd859c1-43e9-442d-9849-eca0a2a00822","1d6ac70d-c973-4de1-98cb-602b725fffc9","33519ec8-48fa-497f-b246-807a31b77c91","4551d3c7-d169-415d-9b54-3fec55049482","f8d53842-b838-48fb-9f4f-b7d52081f621","e7118782-8e5c-4c33-970c-7919b032f91c","1663665f-eddd-4784-9e2d-3d75f436f4a2","b493d3ba-3186-4ea7-9bf1-9f2b967442d1","8aced767-7703-4712-adc9-dc5b7227e61f","e8826ab2-e5ab-4f39-9519-a7139a33dd0e","ea24ad86-f28f-4afb-9a42-ea1e70997db5","d95ac115-8473-44ee-9d23-9830345ecf64","90edf02b-e116-4d36-a57e-620e288efe02","0781cab4-2556-4da4-b9b4-06ad498ba04e","7813c93a-4692-4c38-a119-8deed008adf4","1ab3021e-6ced-41b0-938f-ff0e57e8ff99","66e4941e-2d4b-47e5-aeaf-45980f954ebe","8c582163-83de-4b54-bcb6-f4775d4a42a2","d259126d-f6e1-43ad-a6c3-eb288a0d1ec2","ceabe30d-14d4-4dd8-a228-08208d5cddcf","1fe06692-9d02-41cf-bab7-7c55c1bc3ae4","a055a5a5-0c4c-4207-a22d-2036e957c3cf","66139c5a-d22e-48f7-b728-9ac0c64c1498","241ee98a-a7c3-4976-ba91-c459414cf408","a28b677e-c30c-4eb4-831b-085d1f0ce488","5d1c1461-2145-44f3-8ff0-05a0852298a2","5eed8771-672f-4e58-a774-5d7063cf2c30","952eb292-8660-4a04-8582-309fb96681b5","99880f3d-1577-4237-a85d-65bf26c48ad6","ac4f7a50-3983-4828-95c0-78675e6493ed","d65ad8e5-6d79-4325-b56f-eed154843604","c52c25d0-8026-4ebb-ab81-9add2ce8ded7","e6e357e7-bace-4ec7-8517-1409610e13d1","a1ad3db8-48a2-42f2-ac14-4b7bb8735e6d","05d73e94-01a4-4712-a48b-2c1b1014adc3","d22edf78-9423-4f7c-97b4-08f8504b4712","1f1d6299-bc1d-42b0-afe3-56b1e86599b2","4ee39907-bfc2-4a5c-b807-48ee2ccea821","b34e9a4d-4414-4e4d-9e49-dfb76ab1ba81","c2bcabbc-a1d5-46f1-8a30-1b445f243341","51a02bf5-89d7-4d21-a3f4-170d3f22c895"]);


const MANUAL_EQUIVALENT_URLS: Record<string, string> = {
  "eb150e98-6f87-4175-85a4-35ae838ce207": "https://www.fante.com.br/wp-content/uploads/2024/11/2025-sangalosunset-001-copiar-scaled.png",
  "d109b06d-efbb-4bde-b239-98012e527c80": "https://supermercadoescola.org.br/produto/imagem?id=1274",
  "c3e759d6-0b93-4471-bb11-ee1206f129dc": "https://assets.ibecom.com.br/ib.item.image.large/l-228b9ef97fcc4195b49f897219adb8c0.jpeg",
  "d8c8eb7f-2db4-4772-806d-dd35c26c6793": "https://santaluzia.vtexassets.com/arquivos/ids/1006759/931632.png?v=639111687136070000",
  "8aced767-7703-4712-adc9-dc5b7227e61f": "https://www.sondadelivery.com.br/img.aspx/sku/1583905/530/7894904203420-1-.jpg",
  "e8826ab2-e5ab-4f39-9519-a7139a33dd0e": "https://www.sondadelivery.com.br/img.aspx/sku/1000044608/530/7894904097302-4-.jpg",
  "d95ac115-8473-44ee-9d23-9830345ecf64": "https://www.sondadelivery.com.br/img.aspx/sku/1000044608/530/7894904097302-4-.jpg",
  "d259126d-f6e1-43ad-a6c3-eb288a0d1ec2": "https://phygital-files.mercafacil.com/catalogo/uploads/produto/batata_pr_frita_palito_congelada_bem_brasil_mais_batata_pacote_2kg_6140de74-0a59-4eeb-8488-9df06be214de.jpg",
  "a055a5a5-0c4c-4207-a22d-2036e957c3cf": "https://cdn-cosmos.bluesoft.com.br/products/7892840823412",
  "241ee98a-a7c3-4976-ba91-c459414cf408": "https://www.jauserve.com.br/7899686701133.html",
  "a28b677e-c30c-4eb4-831b-085d1f0ce488": "https://www.jauserve.com.br/7899686702154.html",
  "293d3b69-9e94-4932-823b-256b95c6a60a": "https://acdn-us.mitiendanube.com/stores/005/315/291/products/removedor-666e8788a5aa97b0de17284797889680-1024-1024.png",
  "0901dcea-eaee-4a47-9877-190efc8a209b": "https://aiqfome.com/MS/ponta-pora/takashi-sushi-day"
};

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

function isRelaxedTarget(item: OfferRow) {
  return FORCE_TARGET_IDS.has(item.id) ||
    item.image_match_status === "mass_pending" ||
    item.image_match_status === "mass_retry";
}

type Candidate = {
  source: "open_food_facts" | "open_products_facts" | "open_beauty_facts" | "bing" | "duckduckgo" | "mercado_livre" | "google";
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
  source_url?: string | null;
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

function isHortiItem(item: OfferRow) {
  const text = normalize(item.raw_name);
  const processed =
    /(congelad|picad|ralad|desidrat|conserva|enlat|molho|suco|bebida|polpa|chips|palha|frit|processad|fatiad|vidro|lata|sache|sachê)/.test(text);

  if (text.startsWith("batata ")) {
    return !/(congelad|palito|rustic|palha|chips|frit|mister|yokitos|chiruca|uni sabor|lay|pringles)/.test(text);
  }

  const prefixes = [
    "abacaxi","abobora","abobrinha","acerola","acelga","agriao","alface","alho","alho poro",
    "almeirao","ameixa","atemóia","atemoia","banana","berinjela","beterraba","brocolis",
    "caju","caqui","carambola","cebola","cebolinha","cenoura","chuchu","coco","coentro",
    "cogumelo","couve","couve flor","ervilha","escarola","espinafre","figo","fruta do conde",
    "gengibre","goiaba","graviola","hortela","inhame","jabuticaba","jaca","kiwi","laranja",
    "limao","lichia","maca","mamao","mandarina","mandioca","mandioquinha","manga","maracuja",
    "melancia","melao","mexerica","milho verde","morango","nabo","nectarina","pepino","pera",
    "pessego","pimentao","pitaya","quiabo","rabanete","radicchio","repolho","roma","rucula",
    "salsa","salsao","shimeji","tangerina","tomate","uva","vagem"
  ];

  if (processed) return false;
  return prefixes.some((prefix) => text === prefix || text.startsWith(prefix + " "));
}


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
    ["cereal", /cereal matinal|\bcereal\b/],
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
    ["soap_liquid", /sabonete.*(?:liquido|intimo)|(?:liquido|intimo).*sabonete/],
    ["soap_bar", /\bsabonete\b/],
    ["personal_care", /shampoo|condicionador|desodorante|protetor solar|hidratante|tintura/],
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
  return /barra de proteina|protein bar|toddynho|listerine|antisseptico bucal|probio2|file de merluza|merluza|papel toalha|refrigerante|sukita|farinha de trigo|ketchup|molho barbecue|barbecue|molho de tomate|extrato de tomate|batata doce rosada|ervilhas? finas|jardineira de legumes|bacon|jerked beef|carne seca|charque|linguica calabresa|calabresa defumada|costela suina|uva verde|\bcaju\b|\bmelao\b|mousse de chocolate/.test(text);
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
  if (!processingCompatible(item.raw_name, `${cached.normalized_name} ${cached.external_code ?? ""} ${cached.source_url ?? ""}`)) return 0;

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
    semanticCompatible(item.raw_name, exact.normalized_name) &&
    processingCompatible(item.raw_name, `${exact.normalized_name} ${exact.external_code ?? ""} ${exact.source_url ?? ""}`)
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
    const isSoapFamily =
      expectedFamily === "soap_bar" || expectedFamily === "soap_liquid";
    const expectedPkg = packageBase(item.package_quantity, item.package_unit);

    const familyMatches = libraryRows
      .filter((row) => {
        if (
          !row.image_url ||
          Number(row.confidence) < 0.9 ||
          normalize(row.brand) !== expectedBrand ||
          semanticFamily(row.normalized_name) !== expectedFamily
        ) {
          return false;
        }

        // Soap lines can look very different even within the same brand.
        // Reuse only when the package is compatible; otherwise search the exact
        // item instead of showing a misleading representative image.
        if (isSoapFamily && expectedPkg) {
          const cachedPkg = packageBase(row.package_quantity, row.package_unit);
          if (!cachedPkg || cachedPkg.unit !== expectedPkg.unit) return false;
          const ratio =
            Math.min(expectedPkg.value, cachedPkg.value) /
            Math.max(expectedPkg.value, cachedPkg.value);
          if (ratio < 0.9) return false;
        }

        return true;
      })
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
      .filter((entry) =>
        entry.score >= (isSoapFamily ? 0.6 : 0.34)
      )
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
  if (!processingCompatible(item.raw_name, title)) return null;

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

async function searchMercadoLivre(item: OfferRow, query: string) {
  const found = new Map<string, Candidate>();

  for (const variant of searchQueryVariants(item, query).slice(0, 2)) {
    const url = new URL("https://api.mercadolibre.com/sites/MLB/search");
    url.searchParams.set("q", variant);
    url.searchParams.set("limit", "12");

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)",
      },
      signal: AbortSignal.timeout(12000),
    }).catch(() => null);
    if (!response?.ok) continue;

    const payload = await response.json().catch(() => null);
    const results = Array.isArray(payload?.results) ? payload.results : [];

    const scored: any[] = results
      .map((hit: any) => {
        const title = String(hit?.title ?? "");
        if (!title || !semanticCompatible(item.raw_name, title)) return null;
        if (!processingCompatible(item.raw_name, title)) return null;

        const brandScore = brandSimilarity(item, title, title);
        const nameScore = nameSimilarity(item, title, title);
        const explicitPackage = parseQuantity(title);
        const packageScore = explicitPackage ? packageSimilarity(item, title) : 0.5;

        if (item.brand && brandScore < 0.99) return null;
        if (
          packageBase(item.package_quantity, item.package_unit) &&
          explicitPackage &&
          packageScore < 0.72
        ) {
          return null;
        }
        if (nameScore < 0.34) return null;

        return {
          id: String(hit?.id ?? ""),
          title,
          thumbnail: String(hit?.thumbnail ?? hit?.secure_thumbnail ?? ""),
          score:
            Math.min(1, brandScore) * 0.45 +
            Math.min(1, packageScore) * 0.25 +
            Math.min(1, nameScore) * 0.3,
          brandScore,
          nameScore,
          packageScore,
        };
      })
      .filter((entry: any) => !!entry)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 4);

    for (const hit of scored) {
      let imageUrl = hit.thumbnail;
      if (hit.id) {
        const detail = await fetch(
          "https://api.mercadolibre.com/items/" + encodeURIComponent(hit.id),
          {
            headers: {
              "Accept": "application/json",
              "User-Agent": "Preco360/1.0 (https://preco360.vercel.app)",
            },
            signal: AbortSignal.timeout(8000),
          },
        ).catch(() => null);

        if (detail?.ok) {
          const detailPayload = await detail.json().catch(() => null);
          const picture = Array.isArray(detailPayload?.pictures)
            ? detailPayload.pictures[0]
            : null;
          imageUrl = String(
            picture?.secure_url ??
              picture?.url ??
              detailPayload?.secure_thumbnail ??
              imageUrl,
          );
        }
      }

      if (!imageUrl) continue;
      const candidate: Candidate = {
        source: "mercado_livre",
        imageUrl,
        title: hit.title,
        brandText: hit.title,
        quantityText: hit.title,
        code: hit.id,
        deterministicScore: hit.score,
        brandScore: hit.brandScore,
        nameScore: hit.nameScore,
        packageScore: hit.packageScore,
      };
      const previous = found.get(candidate.code || candidate.imageUrl);
      if (!previous || candidate.deterministicScore > previous.deterministicScore) {
        found.set(candidate.code || candidate.imageUrl, candidate);
      }
    }

    if (found.size >= 4) break;
  }

  return [...found.values()].sort(
    (a, b) => b.deterministicScore - a.deterministicScore,
  );
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function targetLooksLikeMultipack(item: OfferRow) {
  const text = normalize(item.raw_name);
  if (/\bkit\b|\bpack\b/.test(text)) return true;
  const count = text.match(/\b(\d+)\s*(?:un|und|unid|unidades)\b/);
  if (count && Number(count[1]) > 1) return true;
  return normalize(item.package_unit) === "un" && Number(item.package_quantity) > 1;
}

function candidateLooksLikeMultipack(title: string) {
  const text = normalize(title);
  if (/\bkit\b|\bpack\b|atacado/.test(text)) return true;
  const count = text.match(/\b(\d+)\s*(?:un|und|unid|unidades)\b/);
  return !!count && Number(count[1]) > 1;
}

function multipackCompatible(item: OfferRow, title: string) {
  return targetLooksLikeMultipack(item) || !candidateLooksLikeMultipack(title);
}

async function searchBingImages(item: OfferRow, query: string) {
  const found = new Map<string, Candidate>();

  for (const variant of searchQueryVariants(item, query).slice(0, 2)) {
    const url = new URL("https://www.bing.com/images/search");
    url.searchParams.set("q", variant);
    url.searchParams.set("form", "HDRSC3");
    url.searchParams.set("first", "1");
    url.searchParams.set("safeSearch", "Strict");
    url.searchParams.set("setlang", "pt-br");

    const response = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
      },
      signal: AbortSignal.timeout(12000),
    }).catch(() => null);

    if (!response?.ok) continue;
    const html = await response.text().catch(() => "");
    if (!html) continue;

    const metadataPattern = /\sm="([^"]+)"/g;
    for (const match of html.matchAll(metadataPattern)) {
      let meta: any = null;
      try {
        meta = JSON.parse(decodeHtmlAttribute(match[1]));
      } catch {
        continue;
      }

      const imageUrl = String(meta?.murl ?? "").trim();
      const title = String(meta?.t ?? "").trim();
      const pageUrl = String(meta?.purl ?? "").trim();
      if (!imageUrl || !title) continue;
      if (!semanticCompatible(item.raw_name, title)) continue;
      if (!processingCompatible(item.raw_name, `${title} ${pageUrl}`)) continue;
      if (!multipackCompatible(item, title)) continue;

      const brandScore = brandSimilarity(item, title, title);
      const nameScore = nameSimilarity(item, title, title);
      const explicitPackage = parseQuantity(title);
      const packageScore = explicitPackage ? packageSimilarity(item, title) : 0.5;
      const expectedPackage = packageBase(item.package_quantity, item.package_unit);

      if (item.brand && brandScore < (isRelaxedTarget(item) ? 0.5 : 0.99)) continue;
      if (!isRelaxedTarget(item) && expectedPackage && explicitPackage && packageScore < 0.72) continue;
      if (nameScore < (isRelaxedTarget(item) ? 0.18 : 0.34)) continue;

      const deterministicScore =
        Math.min(1, brandScore) * 0.45 +
        Math.min(1, packageScore) * 0.2 +
        Math.min(1, nameScore) * 0.35;

      const candidate: Candidate = {
        source: "bing",
        imageUrl,
        title,
        brandText: title,
        quantityText: title,
        code: pageUrl || imageUrl,
        deterministicScore,
        brandScore,
        nameScore,
        packageScore,
      };

      const key = candidate.code || candidate.imageUrl;
      const previous = found.get(key);
      if (!previous || candidate.deterministicScore > previous.deterministicScore) {
        found.set(key, candidate);
      }

      if (found.size >= 8) break;
    }

    if (found.size >= 5) break;
  }

  return [...found.values()].sort(
    (a, b) => b.deterministicScore - a.deterministicScore,
  );
}


async function searchBingImagesLoose(item: OfferRow, query: string) {
  const url = new URL("https://www.bing.com/images/search");
  url.searchParams.set("q", query + " produto embalagem");
  url.searchParams.set("form", "HDRSC3");
  url.searchParams.set("first", "1");
  url.searchParams.set("safeSearch", "Strict");
  url.searchParams.set("setlang", "pt-br");

  const response = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);

  if (!response?.ok) return [] as Candidate[];
  const html = await response.text().catch(() => "");
  if (!html) return [] as Candidate[];

  const out: Candidate[] = [];
  const metadataPattern = /\sm="([^"]+)"/g;
  for (const match of html.matchAll(metadataPattern)) {
    try {
      const meta = JSON.parse(decodeHtmlAttribute(match[1]));
      const imageUrl = String(meta?.murl ?? "").trim();
      const title = String(meta?.t ?? "").trim();
      const pageUrl = String(meta?.purl ?? "").trim();
      if (!imageUrl) continue;
      if (!processingCompatible(item.raw_name, `${title} ${pageUrl}`)) continue;

      out.push({
        source: "bing",
        imageUrl,
        title: title || query,
        brandText: title || String(item.brand ?? ""),
        quantityText: title || query,
        code: pageUrl || imageUrl,
        deterministicScore: 0.85,
        brandScore: item.brand ? 0.75 : 0.5,
        nameScore: 0.5,
        packageScore: 0.5,
      });
      if (out.length >= 10) break;
    } catch {}
  }
  return out;
}


async function searchDuckDuckGoImagesLoose(item: OfferRow, query: string) {
  const headers = {
    "Accept": "text/html,application/xhtml+xml,application/json,text/javascript,*/*;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
  };

  const pageUrl = new URL("https://duckduckgo.com/");
  pageUrl.searchParams.set("q", query);
  pageUrl.searchParams.set("iar", "images");
  pageUrl.searchParams.set("iax", "images");
  pageUrl.searchParams.set("ia", "images");

  const page = await fetch(pageUrl, {
    headers,
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!page?.ok) return [] as Candidate[];

  const html = await page.text().catch(() => "");
  if (!html) return [] as Candidate[];

  const vqd =
    html.match(/vqd=['"]([^'"]+)['"]/i)?.[1] ||
    html.match(/"vqd"\s*:\s*"([^"]+)"/i)?.[1] ||
    html.match(/vqd=([\d-]+)&/i)?.[1] ||
    "";
  if (!vqd) return [] as Candidate[];

  const api = new URL("https://duckduckgo.com/i.js");
  api.searchParams.set("l", "br-pt");
  api.searchParams.set("o", "json");
  api.searchParams.set("q", query);
  api.searchParams.set("vqd", vqd);
  api.searchParams.set("f", ",,,");
  api.searchParams.set("p", "1");

  const response = await fetch(api, {
    headers: {
      ...headers,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": pageUrl.href,
      "X-Requested-With": "XMLHttpRequest",
    },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!response?.ok) return [] as Candidate[];

  const payload = await response.json().catch(() => null);
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const out: Candidate[] = [];

  for (const result of results) {
    const imageUrl = String(result?.image ?? "").trim();
    if (!imageUrl) continue;
    const title = String(result?.title ?? query).trim() || query;
    const pageUrl = String(result?.url ?? "").trim();
    if (!processingCompatible(item.raw_name, `${title} ${pageUrl}`)) continue;
    out.push({
      source: "duckduckgo",
      imageUrl,
      title,
      brandText: title,
      quantityText: title,
      code: pageUrl || imageUrl,
      deterministicScore: 0.84,
      brandScore: item.brand ? 0.75 : 0.5,
      nameScore: 0.5,
      packageScore: 0.5,
    });
    if (out.length >= 12) break;
  }

  return out;
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
      if (!processingCompatible(item.raw_name, `${title} ${String(hit?.image?.contextLink ?? "")}`)) return null;
      const brandScore = brandSimilarity(item, title, title);
      const nameScore = nameSimilarity(item, title, title);
      const packageScore = parseQuantity(title) ? packageSimilarity(item, title) : 0.5;

      if (item.brand && brandScore < (isRelaxedTarget(item) ? 0.5 : 0.99)) return null;
      if (nameScore < (isRelaxedTarget(item) ? 0.18 : 0.42)) return null;

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
  if (!isRelaxedTarget(item) && (offerLooksFreshOrBulk(item) || offerIsAmbiguousMultiProduct(item))) {
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

  // Bing is used only as a discovery source for non-food products. Every
  // discovered image still goes through strict name/brand/package checks and,
  // unlike catalog images, must pass visual verification before being stored.
  if ((offerLooksNonFood(item) || isRelaxedTarget(item)) && (!best || best.deterministicScore < 0.92)) {
    const webImages = await searchBingImages(item, query);
    if (
      webImages[0] &&
      (!best || webImages[0].deterministicScore > best.deterministicScore)
    ) {
      best = webImages[0];
    }
  }

  if (!best || best.deterministicScore < 0.9) {
    const google = await searchGoogleImages(item, query);
    if (google[0] && (!best || google[0].deterministicScore > best.deterministicScore)) {
      best = google[0];
    }
  }

  if (!best && isRelaxedTarget(item)) {
    const loose = await searchBingImagesLoose(item, query);
    best = loose[0] ?? null;
  }

  if (!best) return { candidate: null, confidence: 0, status: "fallback" };

  if (isRelaxedTarget(item)) {
    const minimumBrandOk = !item.brand || best.brandScore >= 0.5;
    const minimumNameOk = best.nameScore >= 0.18;
    if (!minimumBrandOk || !minimumNameOk) {
      return { candidate: null, confidence: best.deterministicScore, status: "rejected" };
    }
    return {
      candidate: best,
      confidence: Math.max(0.82, Math.min(0.98, best.deterministicScore)),
      status: "verified",
    };
  }

  if (
    best.source !== "google" &&
    best.source !== "mercado_livre" &&
    best.source !== "bing" &&
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
    headers: {
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
      "Referer": candidate.source === "duckduckgo"
        ? "https://duckduckgo.com/"
        : "https://www.google.com/",
    },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!response?.ok) throw new Error("Não foi possível copiar a imagem validada.");

  let contentType = response.headers.get("content-type")?.split(";")[0] || "";
  if (!["image/jpeg","image/png","image/webp"].includes(contentType)) {
    const lowerUrl = candidate.imageUrl.toLowerCase();
    if (/\.png(?:\?|$)/.test(lowerUrl)) contentType = "image/png";
    else if (/\.webp(?:\?|$)/.test(lowerUrl)) contentType = "image/webp";
    else if (/\.(?:jpg|jpeg)(?:\?|$)/.test(lowerUrl)) contentType = "image/jpeg";
    else throw new Error("Formato de imagem não suportado.");
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


async function resolveManualSourceImage(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: {
      "Accept": "text/html,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!response?.ok) return sourceUrl;

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.startsWith("image/")) return sourceUrl;
  if (!contentType.includes("text/html")) return sourceUrl;

  const html = await response.text().catch(() => "");
  if (!html) return sourceUrl;

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /"image"\s*:\s*"([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[1]?.replaceAll("&amp;", "&").trim();
    if (!value) continue;
    try {
      return new URL(value, sourceUrl).href;
    } catch {}
  }

  const sourceEan = sourceUrl.match(/\\d{13}/)?.[0] || "";
  const imageTags = [...html.matchAll(/<img\\b[^>]*>/gi)];
  const fallbackSrcs: string[] = [];
  for (const entry of imageTags) {
    const tag = entry[0];
    const value =
      tag.match(/\\bsrc=["']([^"']+)["']/i)?.[1] ||
      tag.match(/\\bdata-src=["']([^"']+)["']/i)?.[1] ||
      tag.match(/\\bdata-lazy=["']([^"']+)["']/i)?.[1] ||
      tag.match(/\\bdata-lazy-src=["']([^"']+)["']/i)?.[1] ||
      "";
    if (!value || value.startsWith("data:")) continue;

    const alt = (tag.match(/\\balt=["']([^"']*)["']/i)?.[1] || "").toLowerCase();
    const cls = (tag.match(/\\bclass=["']([^"']*)["']/i)?.[1] || "").toLowerCase();
    const cleaned = value.replaceAll("&amp;", "&").trim();
    const looksLikeProduct =
      (sourceEan && cleaned.includes(sourceEan)) ||
      alt.includes("batata") ||
      alt.includes("uni sabor") ||
      /primary|product|pdp|tile-image|product-image/.test(cls);

    try {
      const absolute = new URL(cleaned, sourceUrl).href;
      if (looksLikeProduct) return absolute;
      if (!/logo|icon|sprite|banner|payment|facebook|instagram|youtube/i.test(absolute)) {
        fallbackSrcs.push(absolute);
      }
    } catch {}
  }

  return fallbackSrcs[0] || sourceUrl;
}


async function tryCabocloEquivalent(
  supabase: ReturnType<typeof serviceClient>,
  item: OfferRow,
  query: string,
) {
  const conciseQuery = String(item.raw_name || "").trim() || query;
  const ddgPrimary = await searchDuckDuckGoImagesLoose(item, conciseQuery);
  const ddgSecondary = ddgPrimary.length
    ? []
    : await searchDuckDuckGoImagesLoose(item, query);
  const bingCandidates = [...ddgPrimary, ...ddgSecondary].length
    ? []
    : await searchBingImagesLoose(item, conciseQuery);
  const candidates = [...ddgPrimary, ...ddgSecondary, ...bingCandidates];
  for (const candidate of candidates.slice(0, 18)) {
    if (!processingCompatible(item.raw_name, `${candidate.title} ${candidate.code ?? ""}`)) continue;
    try {
      const imageUrl = await persistCandidateImage(
        supabase,
        item,
        candidate,
        0.82,
        "regra cafe caboclo: " + query,
      );
      await applyImage(supabase, item, {
        imageUrl,
        source: "product_library",
        confidence: 0.82,
        status: "verified",
        query: "regra cafe caboclo: " + query,
      });
      return true;
    } catch {
      // Try the next equivalent image discovered for the same nominal product.
    }
  }
  return false;
}

async function resolveOne(
  supabase: ReturnType<typeof serviceClient>,
  item: OfferRow,
) {
  const query = buildSearchQuery(item);

  const manualImageUrl = MANUAL_EQUIVALENT_URLS[item.id];
  if (manualImageUrl) {
    try {
      const resolvedManualImageUrl = await resolveManualSourceImage(manualImageUrl);
      const candidate: Candidate = {
        source: "bing",
        imageUrl: resolvedManualImageUrl,
        title: item.raw_name,
        brandText: item.brand ?? "",
        quantityText: item.package_quantity && item.package_unit
          ? `${item.package_quantity}${item.package_unit}`
          : item.raw_name,
        code: manualImageUrl,
        deterministicScore: 0.95,
        brandScore: 1,
        nameScore: 1,
        packageScore: 1,
      };
      const imageUrl = await persistCandidateImage(
        supabase,
        item,
        candidate,
        0.95,
        "busca nominal manual: " + query,
      );
      await applyImage(supabase, item, {
        imageUrl,
        source: "product_library",
        confidence: 0.95,
        status: "verified",
        query: "busca nominal manual: " + query,
      });
      return;
    } catch (error) {
      console.warn("manual equivalent image failed", item.id, error);
    }
  }

  // These families have deterministic product-specific visual rules in the UI.
  // Prefer a known-good icon to a fuzzy catalog image that can misrepresent the item.
  if (preferPermanentVisualFallback(item) && !isRelaxedTarget(item)) {
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
    if (isRelaxedTarget(item) && await tryCabocloEquivalent(supabase, item, query)) return;
    await applyImage(supabase, item, {
      imageUrl: null,
      source: "category_fallback",
      confidence: resolved.confidence,
      status: resolved.status === "rejected" ? "rejected" : "fallback",
      query,
    });
    return;
  }

  try {
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
  } catch (error) {
    if (isRelaxedTarget(item) && await tryCabocloEquivalent(supabase, item, query)) return;
    throw error;
  }
}

async function applyCachedLibraryImage(
  supabase: ReturnType<typeof serviceClient>,
  item: OfferRow,
) {
  const cached = await findLibraryImage(supabase, item);
  if (!cached?.row.image_url) return false;

  await applyImage(supabase, item, {
    imageUrl: cached.row.image_url,
    source: cached.familyReuse ? "product_library_family" : "product_library",
    confidence: cached.familyReuse
      ? Math.min(0.9, Number(cached.row.confidence) || 0.9)
      : Number(cached.row.confidence) || 0.9,
    status: "verified",
    query: cached.familyReuse
      ? "reuso por marca + família: " + buildSearchQuery(item)
      : cached.row.search_query || buildSearchQuery(item),
  });
  return true;
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

async function queueFlyerFailuresForRetry(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  flyerId: string,
) {
  const { data: failedRows, error } = await supabase
    .from("flyer_items")
    .select("id")
    .eq("user_id", userId)
    .eq("flyer_id", flyerId)
    .is("image_url", null)
    .in("image_match_status", ["fallback", "rejected"]);

  if (error) throw error;
  const ids = (failedRows ?? []).map((row: any) => row.id);
  if (!ids.length) return 0;

  const { error: queueError } = await supabase
    .from("flyer_items")
    .update({
      image_match_status: "mass_retry",
      image_source: "auto_retry_queue",
      image_confidence: 0,
      image_query: "retry automatico regra cafe caboclo",
    })
    .in("id", ids);
  if (queueError) throw queueError;

  await triggerMassNext(userId, flyerId);
  return ids.length;
}

async function processBatch(flyerId: string) {
  const supabase = serviceClient();

  const { data: flyer, error: flyerError } = await supabase
    .from("flyers")
    .select("id,user_id")
    .eq("id", flyerId)
    .single();
  if (flyerError || !flyer) throw flyerError || new Error("FLYER_NOT_FOUND");

  const { data: rows, error } = await supabase
    .from("flyer_items")
    .select("id,flyer_id,user_id,product_id,raw_name,brand,package_quantity,package_unit,image_url,image_source,image_confidence,image_match_status,image_query")
    .eq("flyer_id", flyerId)
    .is("image_match_status", null)
    .order("source_page", { ascending: true })
    .limit(12);

  if (error) throw error;
  const items = (rows ?? []) as OfferRow[];

  if (!items.length) {
    await queueFlyerFailuresForRetry(supabase, flyer.user_id, flyerId);
    return;
  }

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

  for (let index = 0; index < prepared.length; index += 3) {
    const group = prepared.slice(index, index + 3);
    await Promise.all(
      group.map(async (item) => {
        // A manually/previously verified packaged product always wins over the
        // hortifruti name heuristic.
        if (await applyCachedLibraryImage(supabase, item)) return;

        if (isHortiItem(item)) {
          await applyImage(supabase, item, {
            imageUrl: null,
            source: "horti_skip",
            confidence: 1,
            status: "horti_skipped",
            query: "hortifruti: manter somente icone",
          });
          return;
        }

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

  if ((count ?? 0) > 0) {
    await triggerNext(flyerId);
    return;
  }

  // First pass finished. Any non-hortifruti item that could not be resolved gets
  // one relaxed second pass, including the Café Caboclo equivalent-image rule.
  await queueFlyerFailuresForRetry(supabase, flyer.user_id, flyerId);
}

async function triggerSoapPilotNext(userId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;

  await fetch(url + "/functions/v1/resolve-flyer-images", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope: "soap_pilot",
      user_id: userId,
      internal: true,
    }),
  }).catch(() => {});
}

async function processSoapPilot(userId: string) {
  const supabase = serviceClient();

  const { data: rows, error } = await supabase
    .from("flyer_items")
    .select("id,flyer_id,user_id,product_id,raw_name,brand,package_quantity,package_unit,image_url,image_source,image_confidence,image_match_status,image_query")
    .eq("user_id", userId)
    .eq("image_match_status", "soap_pending")
    .ilike("raw_name", "%sabonete%")
    .order("created_at", { ascending: false })
    .limit(6);

  if (error) throw error;

  const items = ((rows ?? []) as OfferRow[]).filter((item) =>
    /\bsabonete\b/.test(normalize(item.raw_name))
  );

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

  for (let index = 0; index < prepared.length; index += 3) {
    const group = prepared.slice(index, index + 3);
    await Promise.all(
      group.map(async (item) => {
        try {
          await resolveOne(supabase, item);
        } catch (error) {
          console.warn("soap image pilot failed", item.id, error);
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
  }

  const { count } = await supabase
    .from("flyer_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("image_match_status", "soap_pending")
    .ilike("raw_name", "%sabonete%");

  if ((count ?? 0) > 0) await triggerSoapPilotNext(userId);
}


async function triggerMassNext(userId: string, flyerId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;

  await fetch(url + "/functions/v1/resolve-flyer-images", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope: "mass_fill_non_horti",
      user_id: userId,
      flyer_id: flyerId,
      internal: true,
    }),
  }).catch(() => {});
}

async function processMassFlyer(userId: string, flyerId: string) {
  const supabase = serviceClient();

  const { data: rows, error } = await supabase
    .from("flyer_items")
    .select("id,flyer_id,user_id,product_id,raw_name,brand,package_quantity,package_unit,image_url,image_source,image_confidence,image_match_status,image_query")
    .eq("user_id", userId)
    .eq("flyer_id", flyerId)
    .in("image_match_status", ["mass_pending", "mass_retry"])
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

  for (let index = 0; index < prepared.length; index += 3) {
    const group = prepared.slice(index, index + 3);
    await Promise.all(group.map(async (item) => {
      if (await applyCachedLibraryImage(supabase, item)) return;

      if (isHortiItem(item)) {
        await applyImage(supabase, item, {
          imageUrl: null,
          source: "horti_skip",
          confidence: 1,
          status: "horti_skipped",
          query: "hortifruti: manter somente icone",
        });
        return;
      }

      try {
        await resolveOne(supabase, item);
      } catch (error) {
        console.warn("mass image fill failed", item.id, error);
        await applyImage(supabase, item, {
          imageUrl: null,
          source: "category_fallback",
          confidence: 0,
          status: "fallback",
          query: "regra cafe caboclo falhou: " + buildSearchQuery(item),
        });
      }
    }));

    if (index + 3 < prepared.length) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const { count } = await supabase
    .from("flyer_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("flyer_id", flyerId)
    .in("image_match_status", ["mass_pending", "mass_retry"]);

  if ((count ?? 0) > 0) await triggerMassNext(userId, flyerId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const token = String(url.searchParams.get("t") || "");
    const flyerId = String(url.searchParams.get("flyer") || "");
    if (token !== "p360-mass-seq-get-921" || !flyerId) {
      return json(403, { error: "FORBIDDEN" });
    }
    const allowed = new Set([
      "77bc5d88-e003-4166-9fd8-0cc30caa5c75",
      "4ef67cd1-8d76-4e39-bf2b-24904e1b137b",
      "d5506b39-77b8-41bd-8585-8bed81d7393a",
      "a5016828-0cea-4c0d-8c0b-fbb6771bc3e7",
      "8b11998e-8cae-4015-a111-abdd63777c90",
      "9886bf61-21b7-4fe0-a0cb-d38600db0a76",
      "e859e3a9-4e71-432f-8bf9-b4d2e020f3b7"
    ]);
    if (!allowed.has(flyerId)) return json(400, { error: "BAD_FLYER" });
    EdgeRuntime.waitUntil(processMassFlyer("e596fdb9-5827-438a-a01a-f452822ad757", flyerId));
    return json(202, { ok: true, flyer_id: flyerId, status: "processing" });
  }

  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const body = await req.json();
    const caller = await callerIdentity(req);
    const scope = String(body?.scope ?? "").trim();


    if (scope === "targeted_batch_20260921_b") {
      if (String(body?.token ?? "") !== "p360-20260921-batch20-4c7e1a") {
        return json(403, { error: "FORBIDDEN" });
      }
      const supabase = serviceClient();
      const targetIds = ["a055a5a5-0c4c-4207-a22d-2036e957c3cf","66139c5a-d22e-48f7-b728-9ac0c64c1498","241ee98a-a7c3-4976-ba91-c459414cf408","a28b677e-c30c-4eb4-831b-085d1f0ce488","5d1c1461-2145-44f3-8ff0-05a0852298a2","5eed8771-672f-4e58-a774-5d7063cf2c30","952eb292-8660-4a04-8582-309fb96681b5","99880f3d-1577-4237-a85d-65bf26c48ad6","ac4f7a50-3983-4828-95c0-78675e6493ed","d65ad8e5-6d79-4325-b56f-eed154843604","c52c25d0-8026-4ebb-ab81-9add2ce8ded7","e6e357e7-bace-4ec7-8517-1409610e13d1","a1ad3db8-48a2-42f2-ac14-4b7bb8735e6d","05d73e94-01a4-4712-a48b-2c1b1014adc3","d22edf78-9423-4f7c-97b4-08f8504b4712","1f1d6299-bc1d-42b0-afe3-56b1e86599b2","4ee39907-bfc2-4a5c-b807-48ee2ccea821","b34e9a4d-4414-4e4d-9e49-dfb76ab1ba81","c2bcabbc-a1d5-46f1-8a30-1b445f243341","51a02bf5-89d7-4d21-a3f4-170d3f22c895"];
      const { error: resetError } = await supabase
        .from("flyer_items")
        .update({
          image_url: null,
          image_source: null,
          image_confidence: null,
          image_match_status: null,
          image_query: null,
        })
        .in("id", targetIds)
        .neq("image_match_status", "verified");
      if (resetError) throw resetError;

      const flyerIds = ["d5506b39-77b8-41bd-8585-8bed81d7393a","e859e3a9-4e71-432f-8bf9-b4d2e020f3b7","a5016828-0cea-4c0d-8c0b-fbb6771bc3e7","4ef67cd1-8d76-4e39-bf2b-24904e1b137b","77bc5d88-e003-4166-9fd8-0cc30caa5c75"];
      EdgeRuntime.waitUntil(Promise.all(flyerIds.map((flyerId) => processBatch(flyerId))));
      return json(202, {
        ok: true,
        scope: "targeted_batch_20260921_b",
        items: targetIds.length,
        flyers: flyerIds.length,
        status: "resolving",
      });
    }


    if (scope === "mass_fill_non_horti") {
      const tokenOk = String(body?.token ?? "") === "p360-mass-fill-20260921-52bdc8";
      if (!caller.isService && !tokenOk) {
        return json(403, { error: "FORBIDDEN" });
      }

      const userId = caller.isService
        ? String(body?.user_id ?? "").trim()
        : "e596fdb9-5827-438a-a01a-f452822ad757";
      if (!userId) return json(400, { error: "USER_ID_REQUIRED" });

      const requestedFlyerId = String(body?.flyer_id ?? "").trim();
      if (requestedFlyerId) {
        EdgeRuntime.waitUntil(processMassFlyer(userId, requestedFlyerId));
        return json(202, {
          ok: true,
          scope: "mass_fill_non_horti",
          flyer_id: requestedFlyerId,
          status: "processing",
        });
      }

      const supabase = serviceClient();
      const { data: pendingRows, error: pendingError } = await supabase
        .from("flyer_items")
        .select("id,flyer_id,image_match_status,image_url")
        .eq("user_id", userId)
        .or("image_match_status.neq.verified,image_match_status.is.null,image_url.is.null");
      if (pendingError) throw pendingError;

      const pendingIds = (pendingRows ?? []).map((row: any) => row.id);
      if (pendingIds.length) {
        for (let i = 0; i < pendingIds.length; i += 200) {
          const chunk = pendingIds.slice(i, i + 200);
          const { error: queueError } = await supabase
            .from("flyer_items")
            .update({
              image_match_status: "mass_pending",
              image_source: "mass_queue",
              image_confidence: 0,
              image_query: "preenchimento em massa nao-hortifruti",
            })
            .in("id", chunk);
          if (queueError) throw queueError;
        }
      }

      const { data: queued, error: queuedError } = await supabase
        .from("flyer_items")
        .select("flyer_id")
        .eq("user_id", userId)
        .eq("image_match_status", "mass_pending");
      if (queuedError) throw queuedError;

      const flyerIds = [...new Set((queued ?? []).map((row: any) => row.flyer_id).filter(Boolean))];
      EdgeRuntime.waitUntil(Promise.all(
        flyerIds.map((flyerId: string) => processMassFlyer(userId, flyerId))
      ));

      return json(202, {
        ok: true,
        scope: "mass_fill_non_horti",
        queued_items: pendingIds.length,
        flyers: flyerIds.length,
        status: "processing",
      });
    }


    if (scope === "mass_retry_non_horti") {
      const tokenOk = String(body?.token ?? "") === "p360-mass-retry-20260921-ddg-74c2";
      if (!caller.isService && !tokenOk) {
        return json(403, { error: "FORBIDDEN" });
      }

      const userId = caller.isService
        ? String(body?.user_id ?? "").trim()
        : "e596fdb9-5827-438a-a01a-f452822ad757";
      if (!userId) return json(400, { error: "USER_ID_REQUIRED" });

      const requestedFlyerId = String(body?.flyer_id ?? "").trim();
      if (requestedFlyerId) {
        const supabase = serviceClient();
        const { data: failedRows, error: failedError } = await supabase
          .from("flyer_items")
          .select("id")
          .eq("user_id", userId)
          .eq("flyer_id", requestedFlyerId)
          .is("image_url", null)
          .in("image_match_status", ["fallback", "rejected"]);
        if (failedError) throw failedError;

        const failedIds = (failedRows ?? []).map((row: any) => row.id);
        if (failedIds.length) {
          const { error: queueError } = await supabase
            .from("flyer_items")
            .update({
              image_match_status: "mass_retry",
              image_source: "manual_retry_queue",
              image_confidence: 0,
              image_query: "retry direcionado regra cafe caboclo",
            })
            .in("id", failedIds);
          if (queueError) throw queueError;
        }

        EdgeRuntime.waitUntil(processMassFlyer(userId, requestedFlyerId));
        return json(202, {
          ok: true,
          scope: "mass_retry_non_horti",
          flyer_id: requestedFlyerId,
          queued_items: failedIds.length,
          status: "processing",
        });
      }

      const supabase = serviceClient();
      const { data: failedRows, error: failedError } = await supabase
        .from("flyer_items")
        .select("id,flyer_id")
        .eq("user_id", userId)
        .in("image_match_status", ["fallback", "rejected"]);
      if (failedError) throw failedError;

      const failedIds = (failedRows ?? []).map((row: any) => row.id);
      for (let i = 0; i < failedIds.length; i += 200) {
        const chunk = failedIds.slice(i, i + 200);
        const { error: queueError } = await supabase
          .from("flyer_items")
          .update({
            image_match_status: "mass_retry",
            image_source: "mass_retry_queue",
            image_confidence: 0,
            image_query: "retry sequencial regra cafe caboclo",
          })
          .in("id", chunk);
        if (queueError) throw queueError;
      }

      const flyerIds = [...new Set((failedRows ?? []).map((row: any) => row.flyer_id).filter(Boolean))];

      if (body?.queue_only === true) {
        return json(202, {
          ok: true,
          scope: "mass_retry_non_horti",
          queued_items: failedIds.length,
          flyers: flyerIds,
          status: "queued",
        });
      }

      EdgeRuntime.waitUntil(Promise.all(
        flyerIds.map((flyerId: string) => processMassFlyer(userId, flyerId))
      ));

      return json(202, {
        ok: true,
        scope: "mass_retry_non_horti",
        queued_items: failedIds.length,
        flyers: flyerIds.length,
        status: "processing",
      });
    }

    if (scope === "soap_pilot") {
      const requestedUserId = String(body?.user_id ?? "").trim();
      const targetUserId =
        caller.isService && requestedUserId
          ? requestedUserId
          : caller.userId;

      if (!targetUserId) return json(403, { error: "FORBIDDEN" });

      EdgeRuntime.waitUntil(processSoapPilot(targetUserId));
      return json(202, {
        ok: true,
        scope: "soap_pilot",
        status: "resolving",
      });
    }

    const flyerId = String(body?.flyer_id ?? "").trim();
    if (!flyerId) return json(400, { error: "FLYER_ID_REQUIRED" });

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
