import { canonicalRetailerName } from "@/lib/retailerNames";

export type BaseUnit = "kg" | "l" | "un";

export type PackageInfo = {
  quantity: number;
  unit: "g" | "kg" | "ml" | "l" | "un";
  baseUnit: BaseUnit;
  baseQuantity: number;
};

export type FlyerImageBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FlyerCandidate = {
  rawName: string;
  brand?: string | null;
  price: number;
  packageInfo: PackageInfo | null;
  normalizedPrice: number;
  baseUnit: BaseUnit;
  clubPrice: boolean;
  sourcePage: number;
  imageBox?: FlyerImageBox | null;
  imageBoxConfidence?: number | null;
};

export type ProductForMatch = {
  id: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  package_size?: number | null;
  unit?: string | null;
  stockable?: boolean | null;
  image_url?: string | null;
  image_source?: string | null;
  prices?: Array<{ price: number | string; date?: string | null; supermarket?: string | null }> | null;
};

export type AliasForMatch = {
  product_id: string;
  normalized_alias: string;
  retailer?: string | null;
};

export type OfferVerdict = {
  key: "exceptional" | "good" | "normal" | "high" | "unknown";
  label: string;
  message: string;
  deltaPct: number | null;
  referencePrice: number | null;
  bestPurchase: number | null;
  bestAdvertised: number | null;
  purchaseCount: number;
  advertisedCount: number;
  confidence: "alta" | "média" | "baixa";
};

const aliases: Record<string, string> = {
  bisc: "biscoito", biscoitos: "biscoito", fgo: "frango", fr: "frango",
  qj: "queijo", qjo: "queijo", mus: "mussarela", muss: "mussarela",
  mussar: "mussarela", mozzarella: "mussarela", ling: "linguica",
  lingui: "linguica", tosc: "toscana", sobrec: "sobrecoxa",
  sobrecxa: "sobrecoxa", refri: "refrigerante", resf: "resfriado",
  cong: "congelado", bov: "bovina", suin: "suina", mort: "mortadela",
  mant: "manteiga", int: "integral", def: "defumada", fat: "fatiada",
  far: "farinha", mand: "mandioca", ferm: "fermento", desinf: "desinfetante",
  alum: "aluminio", pim: "pimenta", refin: "refinado", vd: "verde",
  ref: "refrigerante", ant: "antarctica", guar: "guarana",
};

const stop = new Set([
  "de", "da", "do", "das", "dos", "e", "ou", "com", "sem", "tipo", "tipos",
  "pacote", "bandeja", "unidade", "unidades", "cada", "leve", "pague", "oferta",
  "promocao", "promocional", "kg", "g", "gr", "ml", "l", "lt", "un", "und", "unid",
  "granel", "embalagem", "lata", "garrafa", "caixa", "refil", "sabor", "sabores",
]);

const packageTokenRe = /^\d+(?:[.,]\d+)?(?:kg|g|gr|ml|l|lt|un|und|unid)$/i;

export function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/([a-z])\.([a-z])/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string) {
  return normalizeSearchText(value).split(/\s+/).map((token) => aliases[token] ?? token)
    .filter((token) =>
      token &&
      !stop.has(token) &&
      !/^\d+$/.test(token) &&
      !packageTokenRe.test(token)
    );
}

function overlapCount(a: string[], b: string[]) {
  const B = new Set(b);
  return [...new Set(a)].filter((token) => B.has(token)).length;
}

function brandTokens(candidate: FlyerCandidate) {
  return candidate.brand ? tokens(candidate.brand) : [];
}

function brandCompatible(candidate: FlyerCandidate, productTokens: string[]) {
  const brand = brandTokens(candidate);
  if (!brand.length) return true;
  return brand.every((token) => productTokens.includes(token));
}

function withoutTokens(source: string[], remove: string[]) {
  if (!remove.length) return source;
  const blocked = new Set(remove);
  return source.filter((token) => !blocked.has(token));
}

function identityCompatible(candidate: FlyerCandidate, candidateTokens: string[], productTokens: string[]) {
  if (!candidateTokens.length || !productTokens.length) return false;

  const brand = brandTokens(candidate);
  const candidateIdentity = withoutTokens(candidateTokens, brand);
  const productIdentity = withoutTokens(productTokens, brand);

  if (!candidateIdentity.length || !productIdentity.length) return false;
  const identityOverlap = overlapCount(candidateIdentity, productIdentity);
  if (!identityOverlap) return false;

  // Brand and package size are supporting evidence, never the product identity itself.
  // Example: "Batata Uni ..." must NOT match "Batata Palha Uni" just because both
  // contain "batata" + "Uni". When one side has a subtype/variant, require a shared
  // subtype token in addition to the category.
  if (
    (candidateIdentity.length > 1 || productIdentity.length > 1) &&
    identityOverlap < 2
  ) {
    return false;
  }

  // If the leading category differs, demand very strong semantic overlap.
  if (candidateIdentity[0] !== productIdentity[0] && identityOverlap < 3) return false;

  return true;
}

function numberPt(value: string) {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function packageNumber(value: string, unit: string) {
  if (value.includes(",")) {
    return Number(value.replace(/\./g, "").replace(",", "."));
  }
  if (
    (unit === "g" || unit === "ml") &&
    /^\d+\.\d{3}$/.test(value)
  ) {
    return Number(value.replace(".", ""));
  }
  return Number(value);
}

function packageInfoFromQuantity(
  quantityValue: number | string | null | undefined,
  unitValue: string | null | undefined,
): PackageInfo | null {
  const quantity = Number(quantityValue);
  const unit = normalizeSearchText(unitValue ?? "");
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  if (unit === "g") {
    return { quantity, unit: "g", baseUnit: "kg", baseQuantity: quantity / 1000 };
  }
  if (unit === "kg") {
    return { quantity, unit: "kg", baseUnit: "kg", baseQuantity: quantity };
  }
  if (unit === "ml") {
    return { quantity, unit: "ml", baseUnit: "l", baseQuantity: quantity / 1000 };
  }
  if (unit === "l" || unit === "lt") {
    return { quantity, unit: "l", baseUnit: "l", baseQuantity: quantity };
  }
  if (["un", "und", "unid", "unidade", "unidades"].includes(unit)) {
    return { quantity, unit: "un", baseUnit: "un", baseQuantity: quantity };
  }
  return null;
}

export function inferPackage(value: string): PackageInfo | null {
  const text = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([a-z])\.([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9.,]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b([a-z]{3,})(kg|ml)\b/g, "$1 $2")
    .replace(/(\d)\s+(kg|g|ml|l|lt|un|und|unid)\b/g, "$1$2");

  const multi = text.match(
    /\b(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lt)\b/i,
  );
  if (multi) {
    const unit = (
      multi[3].toLowerCase() === "lt" ? "l" : multi[3].toLowerCase()
    ) as PackageInfo["unit"];
    const quantity =
      Number(multi[1]) * packageNumber(multi[2], unit);
    return packageInfoFromQuantity(quantity, unit);
  }

  const sizeThenCount = text.match(
    /\b(\d+(?:[.,]\d+)?)\s*(g|ml)\b\s*(?:cada\s*)?(?:cx|caixa|fd|fardo|pct|pacote|pack)\s*(?:com\s*)?(\d+)\s*(?:un|und|unid|unidades?|latas?|rolos?|capsulas?)\b/i,
  );
  if (sizeThenCount) {
    const unit = sizeThenCount[2].toLowerCase();
    const quantity =
      packageNumber(sizeThenCount[1], unit) * Number(sizeThenCount[3]);
    return packageInfoFromQuantity(quantity, unit);
  }

  const countThenSize = text.match(
    /\b(?:cx|caixa|fd|fardo|pct|pacote|pack)\s*(?:com\s*)?(\d+)\s*(?:un|und|unid|unidades?|latas?|rolos?|capsulas?)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i,
  );
  if (countThenSize) {
    const unit = countThenSize[3].toLowerCase();
    const quantity =
      Number(countThenSize[1]) * packageNumber(countThenSize[2], unit);
    return packageInfoFromQuantity(quantity, unit);
  }

  const meterPack = text.match(
    /\b(\d+)\s*x\s*\d+(?:[.,]\d+)?\s*m\b/i,
  );
  if (meterPack) {
    return {
      quantity: Number(meterPack[1]),
      unit: "un",
      baseUnit: "un",
      baseQuantity: Number(meterPack[1]),
    };
  }

  const match = text.match(
    /\b(\d+(?:[.,]\d+)?)\s*(kg|quilo|quilos|g|grama|gramas|ml|l|lt|litro|litros|un|und|unid|unidade|unidades)\b/i,
  );
  if (match) {
    const rawUnit = match[2].toLowerCase();
    const normalizedUnit =
      rawUnit === "lt" || rawUnit === "litro" || rawUnit === "litros"
        ? "l"
        : rawUnit === "grama" || rawUnit === "gramas"
          ? "g"
          : rawUnit === "quilo" || rawUnit === "quilos"
            ? "kg"
            : ["und", "unid", "unidade", "unidades"].includes(rawUnit)
              ? "un"
              : rawUnit;
    const quantity = packageNumber(match[1], normalizedUnit);
    return packageInfoFromQuantity(quantity, normalizedUnit);
  }

  if (/\b(kg|quilo|quilos)\b/.test(text)) {
    return { quantity: 1, unit: "kg", baseUnit: "kg", baseQuantity: 1 };
  }
  if (/\b(litro|litros|lt)\b/.test(text)) {
    return { quantity: 1, unit: "l", baseUnit: "l", baseQuantity: 1 };
  }
  if (/\b(unidade|unidades|und|unid)\b/.test(text)) {
    return { quantity: 1, unit: "un", baseUnit: "un", baseQuantity: 1 };
  }
  return null;
}

export function isCapacitySpecificationProduct(rawName: string) {
  const text = normalizeSearchText(rawName);
  return /^(assadeira|caixa (?:organizadora|termica)|panela(?: de pressao)?|copo (?!descartavel)|jarra|frigideira|travessa|pote (?:tramontina|plasutil|plasvale|marinex|nadir))\b/.test(
    text,
  );
}

function explicitPackCount(value: string) {
  const text = normalizeSearchText(value);
  const multiplied = text.match(/\b(\d+)\s*x\s*\d+/);
  if (multiplied) return Number(multiplied[1]);

  const containerCount = text.match(
    /\b(?:pack|fardo|fd|caixa|cx|pacote|pct)\s*(?:com\s*)?(\d+)\s*(?:un|und|unid|unidades?|latas?|rolos?|capsulas?)\b/,
  );
  if (containerCount) return Number(containerCount[1]);

  const sizeThenCount = text.match(
    /\b\d+(?:\s+\d+)?\s*(?:g|ml)\b\s*(?:cada\s*)?(?:cx|caixa|fd|fardo|pct|pacote|pack)\s*(?:com\s*)?(\d+)\s*(?:un|und|unid|unidades?|latas?|rolos?|capsulas?)\b/,
  );
  return sizeThenCount ? Number(sizeThenCount[1]) : null;
}

function packageUnitPrice(offerNotes: string[] | null | undefined) {
  const raw = (offerNotes ?? []).join(" ");
  const match = raw.match(
    /(?:1\s*)?un(?:idade)?\s+(?:sai|saem)\s+por\s*:?[ ]*r\$\s*(\d+(?:[.,]\d{2}))/i,
  );
  if (!match) return null;
  const price = Number(match[1].replace(",", "."));
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function offerPackageInfo(
  rawName: string,
  packageQuantity?: number | string | null,
  packageUnit?: string | null,
  offerNotes?: string[] | null,
  totalPrice?: number | null,
): PackageInfo | null {
  const normalizedName = normalizeSearchText(rawName);

  // Verified against the previous Tauste flyer: the current OCR/import stored
  // "Biscoito Marilan Maizena 5kg" at the same R$ 5,49 price as the 300 g pack.
  // Keep this correction here while the source row itself is read-only.
  if (
    normalizedName === "biscoito marilan maizena 5kg" &&
    totalPrice !== null &&
    totalPrice !== undefined &&
    totalPrice >= 4 &&
    totalPrice <= 7
  ) {
    return {
      quantity: 300,
      unit: "g",
      baseUnit: "kg",
      baseQuantity: 0.3,
    };
  }

  if (isCapacitySpecificationProduct(rawName)) {
    return { quantity: 1, unit: "un", baseUnit: "un", baseQuantity: 1 };
  }

  const combined = [rawName, ...(offerNotes ?? [])].join(" ");
  let pkg =
    inferPackage(combined) ??
    packageInfoFromQuantity(packageQuantity, packageUnit);

  if (!pkg) return null;

  const unitPrice = packageUnitPrice(offerNotes);
  const explicitCount = explicitPackCount(combined);
  if (
    pkg.baseUnit !== "un" &&
    !explicitCount &&
    unitPrice &&
    totalPrice &&
    Number.isFinite(totalPrice) &&
    totalPrice > unitPrice
  ) {
    const estimatedCount = totalPrice / unitPrice;
    const count = Math.round(estimatedCount);
    if (
      count >= 2 &&
      count <= 100 &&
      Math.abs(estimatedCount - count) <= 0.05
    ) {
      pkg = {
        ...pkg,
        quantity: pkg.quantity * count,
        baseQuantity: pkg.baseQuantity * count,
      };
    }
  }

  return pkg;
}

export function normalizedUnitPrice(price: number, pkg: PackageInfo | null) {
  if (!pkg?.baseQuantity || pkg.baseQuantity <= 0) return { normalizedPrice: price, baseUnit: "un" as BaseUnit };
  return { normalizedPrice: price / pkg.baseQuantity, baseUnit: pkg.baseUnit };
}

export function formatNormalizedPrice(price: number, unit: BaseUnit) {
  const label = unit === "l" ? "L" : unit;
  return `${price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/${label}`;
}

function plausibleName(value: string) {
  const clean = normalizeSearchText(value);
  if (clean.length < 3 || clean.length > 130 || (clean.match(/[a-z]/g) ?? []).length < 3) return false;
  if (/^(ofertas?|validas?|grandes|aniversario|confira|lojas?|precos?|clube|vantagens?|economize|setembro)\b/.test(clean)) return false;
  if (/\b(www|com br|cnpj|cliente|proibida|venda|menores|anos)\b/.test(clean)) return false;
  return true;
}

function cleanName(value: string) {
  return value.replace(/R\$/gi, " ").replace(/[|•●]+/g, " ").replace(/\s+/g, " ")
    .replace(/^[\s:;,.—–-]+|[\s:;,.—–-]+$/g, "").trim();
}

export function parseFlyerText(text: string, sourcePage = 1): FlyerCandidate[] {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const priceRe = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*[.,]\d{2})\b/g;
  const found: FlyerCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const match of line.matchAll(priceRe)) {
      const start = match.index ?? 0;
      let name = cleanName(line.slice(0, start));
      if (!plausibleName(name)) {
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const candidate = cleanName(lines[j].replace(priceRe, " "));
          if (plausibleName(candidate)) { name = candidate; break; }
        }
      }
      if (!plausibleName(name)) continue;
      const price = numberPt(match[1]);
      if (!Number.isFinite(price) || price <= 0 || price > 5000) continue;
      const context = `${lines[Math.max(0, i - 1)] ?? ""} ${line} ${lines[i + 1] ?? ""}`;
      const packageInfo = inferPackage(name) ?? inferPackage(context);
      const normalized = normalizedUnitPrice(price, packageInfo);
      found.push({ rawName: name, price, packageInfo, normalizedPrice: normalized.normalizedPrice,
        baseUnit: normalized.baseUnit, clubPrice: /clube\s*(de)?\s*vantagens?|preco\s*clube/i.test(context), sourcePage });
    }
  }

  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${normalizeSearchText(item.rawName)}|${item.price.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function extractFlyerMeta(text: string) {
  const normalized = normalizeSearchText(text);
  let retailer = "";
  if (normalized.includes("confianca")) retailer = "Confiança";
  else if (normalized.includes("kawakami")) retailer = "Kawakami";
  else if (normalized.includes("carrefour")) retailer = "Carrefour";
  else if (normalized.includes("assai")) retailer = "Assaí";
  else if (normalized.includes("atacadao")) retailer = "Atacadão";
  else if (normalized.includes("pao de acucar")) retailer = "Pão de Açúcar";
  else if (normalized.includes("savegnago")) retailer = "Savegnago";

  let validFrom = "", validTo = "";
  const range = text.match(/(\d{2})[\/.\-](\d{2})(?:[\/.\-](20\d{2}))?\s*(?:a|ate|até|[-–])\s*(\d{2})[\/.\-](\d{2})[\/.\-](20\d{2})/i);
  if (range) {
    const year = range[3] || range[6];
    validFrom = `${year}-${range[2]}-${range[1]}`;
    validTo = `${range[6]}-${range[5]}-${range[4]}`;
  }
  return { retailer, validFrom, validTo };
}

function similarity(a: string[], b: string[]) {
  if (!a.length || !b.length) return { jaccard: 0, containment: 0 };
  const A = new Set(a), B = new Set(b);
  const intersection = [...A].filter((token) => B.has(token)).length;
  return { jaccard: intersection / new Set([...A, ...B]).size, containment: intersection / Math.min(A.size, B.size) };
}

function packageBonus(a: PackageInfo | null, b: PackageInfo | null) {
  if (!a || !b) return 0;
  if (a.baseUnit !== b.baseUnit) return -0.22;
  const ratio = Math.min(a.baseQuantity, b.baseQuantity) / Math.max(a.baseQuantity, b.baseQuantity);
  if (ratio >= 0.95) return 0.12;
  if (ratio >= 0.8) return 0.06;
  if (ratio < 0.5) return -0.08;
  return 0;
}

export function matchFlyerItem(candidate: FlyerCandidate, products: ProductForMatch[], savedAliases: AliasForMatch[], retailer?: string) {
  const normalized = normalizeSearchText(candidate.rawName);
  const alias = savedAliases.find((item) => item.normalized_alias === normalized &&
    (!item.retailer || !retailer || canonicalRetailerName(item.retailer) === canonicalRetailerName(retailer)));
  if (alias) return { productId: alias.product_id, confidence: 1, type: "exact" as const };

  const candidateTokens = tokens(candidate.rawName);
  let best: { id: string; score: number } | null = null;

  for (const product of products) {
    const productTokens = tokens(`${product.name} ${product.brand ?? ""}`);
    if (!identityCompatible(candidate, candidateTokens, productTokens)) continue;
    if (!brandCompatible(candidate, productTokens)) continue;

    const pkg = product.package_size && product.unit
      ? inferPackage(`${product.package_size}${product.unit}`)
      : inferPackage(product.name);

    // Never compare mass, volume and unit histories with each other.
    if (candidate.packageInfo && pkg && candidate.packageInfo.baseUnit !== pkg.baseUnit) continue;

    const sim = similarity(candidateTokens, productTokens);
    let score = sim.jaccard * 0.62 + sim.containment * 0.28 + packageBonus(candidate.packageInfo, pkg);
    if (normalizeSearchText(product.name).includes(normalized) || normalized.includes(normalizeSearchText(product.name))) score += 0.08;
    score = Math.max(0, Math.min(1, score));
    if (!best || score > best.score) best = { id: product.id, score };
  }

  // "Suggested" fuzzy matches are useful for manual review, but are not safe enough
  // to drive a price verdict automatically. Only equivalent/exact matches get productId.
  if (!best || best.score < 0.62) {
    return { productId: null, confidence: best?.score ?? 0, type: "unmatched" as const };
  }
  if (best.score >= 0.8) return { productId: best.id, confidence: best.score, type: "exact" as const };
  return { productId: best.id, confidence: best.score, type: "equivalent" as const };
}

function comparisonTokens(value: string) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => aliases[token] ?? token)
    .filter((token) =>
      token &&
      !stop.has(token) &&
      !/^\d+(?:[.,]\d+)?$/.test(token) &&
      !packageTokenRe.test(token)
    );
}

function hasComparisonToken(tokens: string[], ...wanted: string[]) {
  const set = new Set(tokens);
  return wanted.some((token) => set.has(token));
}

function startsComparison(tokens: string[], ...wanted: string[]) {
  if (!wanted.length || tokens.length < wanted.length) return false;
  return wanted.every((token, index) => tokens[index] === token);
}

export type GenericBasketFamily = {
  key: string;
  label: string;
};

export type BasketNeed = GenericBasketFamily & {
  category: "Cesta básica" | "Mimos e lanches" | "Bebidas" | "Higiene" | "Limpeza";
  aliases: string[];
  baseUnit: "kg" | "l" | "un";
};

/**
 * Necessidades independentes de SKU/preço. A Cesta usa este catálogo mesmo
 * quando nenhum tabloide ou compra anterior possui o item.
 */
export const basketNeedsCatalog: BasketNeed[] = [
  { key: "graos:arroz", label: "Arroz", category: "Cesta básica", aliases: ["arroz branco", "arroz tipo 1"], baseUnit: "kg" },
  { key: "graos:feijao", label: "Feijão", category: "Cesta básica", aliases: ["feijao carioca", "feijao preto"], baseUnit: "kg" },
  { key: "mercearia:oleo-soja", label: "Óleo de soja", category: "Cesta básica", aliases: ["oleo", "óleo", "oleo vegetal"], baseUnit: "l" },
  { key: "mercearia:acucar", label: "Açúcar", category: "Cesta básica", aliases: ["acucar", "açucar", "acucar cristal", "acucar refinado"], baseUnit: "kg" },
  { key: "mercearia:cafe", label: "Café", category: "Cesta básica", aliases: ["cafe", "café em po", "cafe torrado e moido"], baseUnit: "kg" },
  { key: "mercearia:sal", label: "Sal", category: "Cesta básica", aliases: ["sal refinado", "sal de cozinha"], baseUnit: "kg" },
  { key: "farinha:trigo", label: "Farinha de trigo", category: "Cesta básica", aliases: ["farinha trigo"], baseUnit: "kg" },
  { key: "farinha:mandioca", label: "Farinha de mandioca", category: "Cesta básica", aliases: ["farinha mandioca"], baseUnit: "kg" },
  { key: "farinha:fuba", label: "Fubá", category: "Cesta básica", aliases: ["fuba", "fubá mimoso"], baseUnit: "kg" },
  { key: "mercearia:macarrao", label: "Macarrão", category: "Cesta básica", aliases: ["macarrao", "massa macarrao", "massa seca"], baseUnit: "kg" },
  { key: "tomate:molho", label: "Molho de tomate", category: "Cesta básica", aliases: ["molho tomate"], baseUnit: "kg" },
  { key: "tomate:extrato", label: "Extrato de tomate", category: "Cesta básica", aliases: ["extrato tomate"], baseUnit: "kg" },
  { key: "milho:verde", label: "Milho verde", category: "Cesta básica", aliases: ["milho verde lata", "milho em lata", "milho lata", "milho verde em conserva"], baseUnit: "kg" },
  { key: "leite:liquido", label: "Leite", category: "Cesta básica", aliases: ["leite longa vida", "leite uht"], baseUnit: "l" },
  { key: "leite:po", label: "Leite em pó", category: "Cesta básica", aliases: ["leite po"], baseUnit: "kg" },
  { key: "laticinio:margarina", label: "Margarina", category: "Cesta básica", aliases: ["margarina com sal"], baseUnit: "kg" },
  { key: "laticinio:manteiga", label: "Manteiga", category: "Cesta básica", aliases: ["manteiga com sal"], baseUnit: "kg" },
  { key: "mercearia:ovos", label: "Ovos", category: "Cesta básica", aliases: ["ovo", "duzia de ovos", "dúzia de ovos"], baseUnit: "un" },
  { key: "pao:forma", label: "Pão de forma", category: "Cesta básica", aliases: ["pao forma"], baseUnit: "kg" },
  { key: "mercearia:sardinha", label: "Sardinha", category: "Cesta básica", aliases: ["sardinha lata", "sardinha em lata"], baseUnit: "kg" },
  { key: "mercearia:atum", label: "Atum", category: "Cesta básica", aliases: ["atum lata", "atum em lata"], baseUnit: "kg" },

  { key: "mimos:chocolate", label: "Chocolate", category: "Mimos e lanches", aliases: ["barra de chocolate", "chocolate barra"], baseUnit: "kg" },
  { key: "mimos:biscoito-recheado", label: "Biscoito recheado", category: "Mimos e lanches", aliases: ["bolacha recheada", "biscoito recheado", "bolacha recheado"], baseUnit: "kg" },
  { key: "mimos:cream-cracker", label: "Biscoito cream cracker", category: "Mimos e lanches", aliases: ["cream cracker", "biscoito agua e sal", "bolacha agua e sal", "água e sal"], baseUnit: "kg" },
  { key: "mimos:maisena", label: "Biscoito maisena", category: "Mimos e lanches", aliases: ["bolacha maisena", "biscoito maizena", "bolacha maizena"], baseUnit: "kg" },
  { key: "mimos:wafer", label: "Wafer", category: "Mimos e lanches", aliases: ["biscoito wafer", "bolacha wafer"], baseUnit: "kg" },
  { key: "mimos:bombom", label: "Bombom", category: "Mimos e lanches", aliases: ["bombons", "caixa de bombom"], baseUnit: "kg" },
  { key: "mimos:salgadinho", label: "Salgadinho", category: "Mimos e lanches", aliases: ["snack", "salgadinho de milho", "chips"], baseUnit: "kg" },
  { key: "mimos:sorvete", label: "Sorvete", category: "Mimos e lanches", aliases: ["sorvete pote"], baseUnit: "l" },
  { key: "mercearia:achocolatado-po", label: "Achocolatado em pó", category: "Mimos e lanches", aliases: ["achocolatado", "nescau em po", "toddy em po"], baseUnit: "kg" },

  { key: "bebida:refrigerante", label: "Refrigerante", category: "Bebidas", aliases: ["refri"], baseUnit: "l" },
  { key: "bebida:suco", label: "Suco", category: "Bebidas", aliases: ["suco pronto", "nectar"], baseUnit: "l" },
  { key: "bebida:agua", label: "Água mineral", category: "Bebidas", aliases: ["agua", "água", "agua mineral"], baseUnit: "l" },
  { key: "bebida:cerveja-sem-alcool", label: "Cerveja sem álcool", category: "Bebidas", aliases: ["cerveja zero", "cerveja 0 alcool", "cerveja zero alcool", "cerveja sem alcool"], baseUnit: "l" },

  { key: "higiene:papel-higienico", label: "Papel higiênico", category: "Higiene", aliases: ["papel higienico"], baseUnit: "un" },
  { key: "higiene:creme-dental", label: "Creme dental", category: "Higiene", aliases: ["pasta de dente", "pasta dental"], baseUnit: "kg" },
  { key: "higiene:sabonete-barra", label: "Sabonete em barra", category: "Higiene", aliases: ["sabonete"], baseUnit: "un" },
  { key: "higiene:sabonete-liquido", label: "Sabonete líquido", category: "Higiene", aliases: ["sabonete liquido"], baseUnit: "l" },
  { key: "higiene:shampoo", label: "Shampoo", category: "Higiene", aliases: ["xampu"], baseUnit: "l" },
  { key: "higiene:condicionador", label: "Condicionador", category: "Higiene", aliases: [], baseUnit: "l" },
  { key: "higiene:desodorante", label: "Desodorante", category: "Higiene", aliases: [], baseUnit: "un" },

  { key: "limpeza:detergente", label: "Detergente", category: "Limpeza", aliases: ["lava loucas", "lava louça"], baseUnit: "l" },
  { key: "limpeza:sabao-po", label: "Sabão em pó", category: "Limpeza", aliases: ["sabao po", "lava roupas em po"], baseUnit: "kg" },
  { key: "limpeza:amaciante", label: "Amaciante", category: "Limpeza", aliases: [], baseUnit: "l" },
  { key: "limpeza:agua-sanitaria", label: "Água sanitária", category: "Limpeza", aliases: ["agua sanitaria", "alvejante clorado"], baseUnit: "l" },
  { key: "limpeza:desinfetante", label: "Desinfetante", category: "Limpeza", aliases: [], baseUnit: "l" },
  { key: "limpeza:multiuso", label: "Limpador multiuso", category: "Limpeza", aliases: ["multiuso", "limpador geral"], baseUnit: "l" },
  { key: "limpeza:papel-toalha", label: "Papel toalha", category: "Limpeza", aliases: ["papel de cozinha"], baseUnit: "un" },
];

export function genericBasketFamily(value: string): GenericBasketFamily | null {
  const t = comparisonTokens(value);
  if (!t.length) return null;

  // Dairy: keep derivatives separate, but ignore brand and package size.
  if (startsComparison(t, "creme", "leite")) {
    return { key: "leite:creme", label: "Creme de leite" };
  }
  if (startsComparison(t, "doce", "leite")) {
    return { key: "leite:doce", label: "Doce de leite" };
  }
  if (startsComparison(t, "leite")) {
    if (hasComparisonToken(t, "condensado")) {
      return { key: "leite:condensado", label: "Leite condensado" };
    }
    if (hasComparisonToken(t, "fermentado")) {
      return { key: "leite:fermentado", label: "Leite fermentado" };
    }
    if (hasComparisonToken(t, "coco")) {
      return { key: "leite:coco", label: "Leite de coco" };
    }
    if (hasComparisonToken(t, "po")) {
      return { key: "leite:po", label: "Leite em pó" };
    }
    return { key: "leite:liquido", label: "Leite" };
  }

  // Tomato products must begin with the product family. This avoids grouping
  // things such as sardines "ao molho de tomate" with tomato sauce itself.
  if (startsComparison(t, "molho", "tomate")) {
    return { key: "tomate:molho", label: "Molho de tomate" };
  }
  if (startsComparison(t, "extrato", "tomate")) {
    return { key: "tomate:extrato", label: "Extrato de tomate" };
  }
  if (startsComparison(t, "passata")) {
    return { key: "tomate:passata", label: "Passata de tomate" };
  }
  if (
    startsComparison(t, "tomate") &&
    hasComparisonToken(t, "pelado", "pelados", "pelada", "peladas")
  ) {
    return { key: "tomate:pelado", label: "Tomate pelado" };
  }

  if (
    startsComparison(t, "farinha") &&
    hasComparisonToken(t, "trigo")
  ) {
    return { key: "farinha:trigo", label: "Farinha de trigo" };
  }

  if (startsComparison(t, "papel", "higienico")) {
    return { key: "higiene:papel-higienico", label: "Papel higiênico" };
  }

  if (startsComparison(t, "papel", "toalha")) {
    return { key: "limpeza:papel-toalha", label: "Papel toalha" };
  }

  if (startsComparison(t, "azeite")) {
    return { key: "mercearia:azeite", label: "Azeite" };
  }

  if (
    startsComparison(t, "achocolatado") &&
    !hasComparisonToken(t, "bebida", "lactea", "liquido")
  ) {
    return { key: "mercearia:achocolatado-po", label: "Achocolatado em pó" };
  }

  if (startsComparison(t, "creme", "dental")) {
    return { key: "higiene:creme-dental", label: "Creme dental" };
  }

  if (startsComparison(t, "sabonete")) {
    if (hasComparisonToken(t, "intimo")) {
      return { key: "higiene:sabonete-intimo", label: "Sabonete íntimo" };
    }
    if (hasComparisonToken(t, "liquido")) {
      return { key: "higiene:sabonete-liquido", label: "Sabonete líquido" };
    }
    return { key: "higiene:sabonete-barra", label: "Sabonete em barra" };
  }

  if (startsComparison(t, "detergente")) {
    return { key: "limpeza:detergente", label: "Detergente" };
  }

  if (startsComparison(t, "amaciante")) {
    return { key: "limpeza:amaciante", label: "Amaciante" };
  }

  if (startsComparison(t, "agua", "sanitaria")) {
    return { key: "limpeza:agua-sanitaria", label: "Água sanitária" };
  }

  if (
    startsComparison(t, "sabao") &&
    hasComparisonToken(t, "po")
  ) {
    return { key: "limpeza:sabao-po", label: "Sabão em pó" };
  }

  if (startsComparison(t, "shampoo")) {
    return { key: "higiene:shampoo", label: "Shampoo" };
  }

  if (startsComparison(t, "condicionador")) {
    return { key: "higiene:condicionador", label: "Condicionador" };
  }

  if (startsComparison(t, "desodorante")) {
    return { key: "higiene:desodorante", label: "Desodorante" };
  }

  if (startsComparison(t, "arroz")) {
    return { key: "graos:arroz", label: "Arroz" };
  }

  if (startsComparison(t, "feijao")) {
    if (hasComparisonToken(t, "preto")) {
      return { key: "graos:feijao-preto", label: "Feijão preto" };
    }
    if (hasComparisonToken(t, "carioca")) {
      return { key: "graos:feijao-carioca", label: "Feijão carioca" };
    }
    return { key: "graos:feijao", label: "Feijão" };
  }

  if (startsComparison(t, "acucar")) {
    if (hasComparisonToken(t, "mascavo")) {
      return { key: "mercearia:acucar-mascavo", label: "Açúcar mascavo" };
    }
    if (hasComparisonToken(t, "demerara")) {
      return { key: "mercearia:acucar-demerara", label: "Açúcar demerara" };
    }
    return { key: "mercearia:acucar", label: "Açúcar" };
  }

  if (
    startsComparison(t, "oleo") &&
    hasComparisonToken(t, "soja")
  ) {
    return { key: "mercearia:oleo-soja", label: "Óleo de soja" };
  }

  if (startsComparison(t, "cafe")) {
    if (hasComparisonToken(t, "capsula", "capsulas")) return null;
    if (hasComparisonToken(t, "soluvel")) {
      return { key: "mercearia:cafe-soluvel", label: "Café solúvel" };
    }
    if (hasComparisonToken(t, "grao", "graos")) {
      return { key: "mercearia:cafe-graos", label: "Café em grãos" };
    }
    return { key: "mercearia:cafe", label: "Café" };
  }

  if (startsComparison(t, "manteiga")) {
    return { key: "laticinio:manteiga", label: "Manteiga" };
  }
  if (startsComparison(t, "margarina")) {
    return { key: "laticinio:margarina", label: "Margarina" };
  }

  if (
    startsComparison(t, "macarrao") ||
    startsComparison(t, "massa")
  ) {
    return { key: "mercearia:macarrao", label: "Macarrão" };
  }

  if (startsComparison(t, "refrigerante")) {
    return { key: "bebida:refrigerante", label: "Refrigerante" };
  }
  if (startsComparison(t, "suco")) {
    return { key: "bebida:suco", label: "Suco" };
  }

  if (
    startsComparison(t, "milho") &&
    hasComparisonToken(t, "verde", "conserva")
  ) {
    return { key: "milho:verde", label: "Milho verde" };
  }

  if (startsComparison(t, "sal")) {
    return { key: "mercearia:sal", label: "Sal" };
  }

  if (startsComparison(t, "ovo") || startsComparison(t, "ovos")) {
    return { key: "mercearia:ovos", label: "Ovos" };
  }

  if (startsComparison(t, "fuba")) {
    return { key: "farinha:fuba", label: "Fubá" };
  }

  if (
    startsComparison(t, "farinha") &&
    hasComparisonToken(t, "mandioca")
  ) {
    return { key: "farinha:mandioca", label: "Farinha de mandioca" };
  }

  if (startsComparison(t, "pao") && hasComparisonToken(t, "forma")) {
    return { key: "pao:forma", label: "Pão de forma" };
  }

  if (startsComparison(t, "sardinha")) {
    return { key: "mercearia:sardinha", label: "Sardinha" };
  }

  if (startsComparison(t, "atum")) {
    return { key: "mercearia:atum", label: "Atum" };
  }

  if (
    (startsComparison(t, "biscoito") || startsComparison(t, "bolacha")) &&
    hasComparisonToken(t, "recheado", "recheada")
  ) {
    return { key: "mimos:biscoito-recheado", label: "Biscoito recheado" };
  }

  if (
    hasComparisonToken(t, "cream") &&
    hasComparisonToken(t, "cracker")
  ) {
    return { key: "mimos:cream-cracker", label: "Biscoito cream cracker" };
  }

  if (
    (startsComparison(t, "biscoito") || startsComparison(t, "bolacha")) &&
    hasComparisonToken(t, "agua") &&
    hasComparisonToken(t, "sal")
  ) {
    return { key: "mimos:cream-cracker", label: "Biscoito cream cracker" };
  }

  if (
    (startsComparison(t, "biscoito") || startsComparison(t, "bolacha")) &&
    hasComparisonToken(t, "maisena", "maizena")
  ) {
    return { key: "mimos:maisena", label: "Biscoito maisena" };
  }

  if (
    startsComparison(t, "wafer") ||
    ((startsComparison(t, "biscoito") || startsComparison(t, "bolacha")) &&
      hasComparisonToken(t, "wafer"))
  ) {
    return { key: "mimos:wafer", label: "Wafer" };
  }

  if (
    startsComparison(t, "chocolate") ||
    (startsComparison(t, "barra") && hasComparisonToken(t, "chocolate"))
  ) {
    return { key: "mimos:chocolate", label: "Chocolate" };
  }

  if (startsComparison(t, "bombom") || startsComparison(t, "bombons")) {
    return { key: "mimos:bombom", label: "Bombom" };
  }

  if (
    startsComparison(t, "salgadinho") ||
    startsComparison(t, "snack")
  ) {
    return { key: "mimos:salgadinho", label: "Salgadinho" };
  }

  if (startsComparison(t, "sorvete")) {
    return { key: "mimos:sorvete", label: "Sorvete" };
  }

  if (startsComparison(t, "agua") && hasComparisonToken(t, "mineral")) {
    return { key: "bebida:agua", label: "Água mineral" };
  }

  if (
    startsComparison(t, "cerveja") &&
    hasComparisonToken(t, "zero", "alcool")
  ) {
    return { key: "bebida:cerveja-sem-alcool", label: "Cerveja sem álcool" };
  }

  if (startsComparison(t, "desinfetante")) {
    return { key: "limpeza:desinfetante", label: "Desinfetante" };
  }

  if (
    startsComparison(t, "multiuso") ||
    (startsComparison(t, "limpador") && hasComparisonToken(t, "multiuso"))
  ) {
    return { key: "limpeza:multiuso", label: "Limpador multiuso" };
  }

  return null;
}

export function genericBasketFamilies(value: string): GenericBasketFamily[] {
  const primary = genericBasketFamily(value);
  if (!primary) return [];

  const families: GenericBasketFamily[] = [primary];
  const t = comparisonTokens(value);

  // Brand-level need: "Nescau" means the powder product regardless of pack size,
  // while "Achocolatado em pó" remains brand-agnostic and includes Nescau too.
  if (
    primary.key === "mercearia:achocolatado-po" &&
    hasComparisonToken(t, "nescau")
  ) {
    families.push({
      key: "marca:nescau-achocolatado-po",
      label: "Nescau em pó",
    });
  }

  return families;
}

function milkVariant(tokens: string[]) {
  if (
    hasComparisonToken(tokens, "zero") &&
    hasComparisonToken(tokens, "lactose")
  ) {
    if (hasComparisonToken(tokens, "desnatado")) return "zero-desnatado";
    if (hasComparisonToken(tokens, "semidesnatado")) return "zero-semi";
    return "zero-lactose";
  }
  if (hasComparisonToken(tokens, "desnatado")) return "desnatado";
  if (hasComparisonToken(tokens, "semidesnatado")) return "semidesnatado";
  if (hasComparisonToken(tokens, "integral")) return "integral";
  return "generico";
}

function purchaseComparisonKey(value: string) {
  const t = comparisonTokens(value);
  if (!t.length) return null;

  if (startsComparison(t, "leite")) {
    if (hasComparisonToken(t, "condensado")) return "leite:condensado";
    if (hasComparisonToken(t, "fermentado")) return "leite:fermentado";
    if (hasComparisonToken(t, "coco")) return "leite:coco";
    if (hasComparisonToken(t, "po")) return "leite:po";
    return `leite:liquido:${milkVariant(t)}`;
  }

  if (startsComparison(t, "creme", "leite")) return "leite:creme";
  if (startsComparison(t, "doce", "leite")) return "leite:doce";

  if (startsComparison(t, "milho")) {
    if (hasComparisonToken(t, "pipoca")) return "milho:pipoca";
    if (hasComparisonToken(t, "verde")) return "milho:verde";
  }

  if (startsComparison(t, "cafe")) {
    if (hasComparisonToken(t, "capsula", "capsulas")) return "cafe:capsula";
    if (hasComparisonToken(t, "soluvel")) return "cafe:soluvel";
    if (hasComparisonToken(t, "grao", "graos")) return "cafe:grao";
    return "cafe:po";
  }
  if (
    hasComparisonToken(t, "cafe") &&
    hasComparisonToken(t, "capsula", "capsulas")
  ) {
    return "cafe:capsula";
  }

  if (startsComparison(t, "tomate")) return "hortifruti:tomate";
  if (startsComparison(t, "cebola")) return "hortifruti:cebola";
  if (startsComparison(t, "cenoura")) return "hortifruti:cenoura";
  if (startsComparison(t, "chuchu")) return "hortifruti:chuchu";
  if (startsComparison(t, "maca")) return "hortifruti:maca";
  if (startsComparison(t, "manga")) return "hortifruti:manga";
  if (startsComparison(t, "maracuja")) return "hortifruti:maracuja";
  if (startsComparison(t, "tangerina")) return "hortifruti:tangerina";
  if (startsComparison(t, "uva") && hasComparisonToken(t, "verde")) {
    return "hortifruti:uva-verde";
  }

  if (startsComparison(t, "batata")) {
    if (hasComparisonToken(t, "palha")) return "batata:palha";
    if (hasComparisonToken(t, "palito")) return "batata:palito";
  }

  if (
    hasComparisonToken(t, "carne") &&
    hasComparisonToken(t, "moida")
  ) {
    return "carne:bovina-moida";
  }
  if (hasComparisonToken(t, "coxao") && hasComparisonToken(t, "duro")) {
    return "carne:coxao-duro";
  }
  if (hasComparisonToken(t, "miolo") && hasComparisonToken(t, "acem")) {
    return "carne:miolo-acem";
  }
  if (
    hasComparisonToken(t, "coxa") &&
    hasComparisonToken(t, "sobrecoxa") &&
    hasComparisonToken(t, "frango")
  ) {
    return "frango:coxa-sobrecoxa";
  }
  if (
    hasComparisonToken(t, "linguica") &&
    hasComparisonToken(t, "toscana")
  ) {
    return "linguica:toscana";
  }

  if (startsComparison(t, "manteiga")) return "laticinio:manteiga";
  if (startsComparison(t, "fuba")) return "farinha:fuba";
  if (
    startsComparison(t, "farinha") &&
    hasComparisonToken(t, "mandioca")
  ) {
    return "farinha:mandioca";
  }
  if (startsComparison(t, "goiabada")) return "doce:goiabada";

  if (startsComparison(t, "pao") && hasComparisonToken(t, "forma")) {
    return "pao:forma";
  }
  if (startsComparison(t, "pao") && hasComparisonToken(t, "frances")) {
    return hasComparisonToken(t, "congelado")
      ? "pao:frances:congelado"
      : "pao:frances:fresco";
  }

  if (startsComparison(t, "mortadela")) {
    if (hasComparisonToken(t, "defumada")) return "mortadela:defumada";
    if (hasComparisonToken(t, "ouro")) return "mortadela:ouro";
    return "mortadela:generica";
  }

  if (
    hasComparisonToken(t, "queijo") &&
    hasComparisonToken(t, "mussarela")
  ) {
    if (hasComparisonToken(t, "fatiada", "fatiado")) {
      return "queijo:mussarela:fatiado";
    }
    if (hasComparisonToken(t, "peca")) return "queijo:mussarela:peca";
    return "queijo:mussarela:generica";
  }

  if (
    (startsComparison(t, "refrigerante") || startsComparison(t, "guarana")) &&
    hasComparisonToken(t, "guarana") &&
    hasComparisonToken(t, "antarctica")
  ) {
    return "refrigerante:guarana-antarctica";
  }

  if (
    startsComparison(t, "oleo") &&
    hasComparisonToken(t, "soja")
  ) {
    return "oleo:soja";
  }
  if (
    startsComparison(t, "sal") &&
    hasComparisonToken(t, "refinado")
  ) {
    return "sal:refinado";
  }
  if (startsComparison(t, "acucar")) {
    if (hasComparisonToken(t, "mascavo")) return "acucar:mascavo";
    if (hasComparisonToken(t, "demerara")) return "acucar:demerara";
    if (hasComparisonToken(t, "refinado")) return "acucar:refinado";
    if (hasComparisonToken(t, "cristal")) return "acucar:cristal";
    return "acucar:generico";
  }

  if (
    startsComparison(t, "lava", "louca") ||
    startsComparison(t, "lava", "loucas")
  ) {
    return "limpeza:lava-louca";
  }
  if (startsComparison(t, "filme", "pvc")) return "casa:filme-pvc";
  if (startsComparison(t, "papel", "aluminio")) return "casa:papel-aluminio";

  return null;
}

function purchaseKeysCompatible(left: string, right: string) {
  if (left === right) return true;

  // Generic liquid milk can use a specific regular-milk purchase as reference,
  // but explicit variants (zero lactose, desnatado, etc.) never cross-match.
  if (left.startsWith("leite:liquido:") && right.startsWith("leite:liquido:")) {
    const a = left.split(":")[2];
    const b = right.split(":")[2];
    return a === b || a === "generico" || b === "generico";
  }

  // A receipt may omit the sugar subtype. Generic sugar is safe only against
  // ordinary refined/crystal sugar, never mascavo/demerara.
  if (left.startsWith("acucar:") && right.startsWith("acucar:")) {
    const safe = new Set(["generico", "refinado", "cristal"]);
    return safe.has(left.split(":")[1]) && safe.has(right.split(":")[1]);
  }

  return false;
}

export function offerReferenceFamilyKey(value: string) {
  const text = normalizeSearchText(value);

  if (/^(?:papel toalha|toalha de papel)\b/.test(text)) {
    return /\binterfolh(?:a|ado|ada|ados|adas)?\b/.test(text)
      ? "limpeza:papel-toalha-interfolhado"
      : "limpeza:papel-toalha-rolo";
  }

  if (/^papel higienico\b/.test(text)) {
    if (/\bfolha simples\b/.test(text)) {
      return "higiene:papel-higienico:simples";
    }
    if (/\bfolha dupla\b/.test(text) || /\bf d\b/.test(text)) {
      return "higiene:papel-higienico:dupla";
    }
    return "higiene:papel-higienico";
  }

  if (/^toalha umedecida\b/.test(text)) {
    return "higiene:toalha-umedecida";
  }

  if (/^fralda\b/.test(text)) {
    return /\bgeriatrica\b/.test(text)
      ? "higiene:fralda-geriatrica"
      : "higiene:fralda-infantil";
  }

  if (/^alimento para caes ou gatos\b/.test(text)) {
    return "pet:caes-gatos";
  }
  if (/^alimento para caes\b/.test(text)) return "pet:caes";
  if (/^alimento para gatos\b/.test(text)) return "pet:gatos";

  if (/^limpador perfumado\b/.test(text)) {
    return /\b(?:concentrado|conc)\b/.test(text)
      ? "limpeza:limpador-perfumado-concentrado"
      : "limpeza:limpador-perfumado-pronto";
  }

  if (/^capsulas?\b/.test(text)) return "cafe:capsula";

  if (/^gelatina\b/.test(text)) {
    return /\b(?:zero|diet|sem acucar)\b/.test(text)
      ? "mercearia:gelatina-zero"
      : "mercearia:gelatina-regular";
  }

  if (/^bebida lactea\b/.test(text)) {
    if (/\b(?:whey|proteina|proteica|proplay|yopro)\b/.test(text)) {
      return "laticinio:bebida-lactea-proteica";
    }
    if (/\b(?:cappuccino|cafe)\b/.test(text)) {
      return "laticinio:bebida-lactea-cafe";
    }
    return "laticinio:bebida-lactea-comum";
  }

  if (/^amaciante\b/.test(text)) {
    return /\b(?:concentrado|concentrada|conc)\b/.test(text)
      ? "limpeza:amaciante-concentrado"
      : "limpeza:amaciante-regular";
  }

  if (/^shampoo\b/.test(text)) {
    if (/\b(?:procao|pet|caes|cao|gatos|gato)\b/.test(text)) {
      return "pet:shampoo";
    }
    return "higiene:shampoo-humano";
  }

  if (/^batata\b/.test(text)) {
    if (/\bpalha\b/.test(text)) return "batata:palha";
    if (
      /\b(?:palito|rustica|congelada|congelado|air fryer|frita|fritas)\b/.test(
        text,
      )
    ) {
      return "batata:congelada";
    }
    return "hortifruti:batata";
  }

  if (/^bolo\b/.test(text)) {
    return /\bpote\b/.test(text) ? "padaria:bolo-pote" : "padaria:bolo";
  }

  const purchaseKey = purchaseComparisonKey(value);
  if (purchaseKey) return purchaseKey;

  const genericKey = genericBasketFamily(value)?.key;
  if (genericKey) return genericKey;

  if (/^caixa organizadora\b/.test(text)) return "casa:caixa-organizadora";
  if (/^caixa termica\b/.test(text)) return "casa:caixa-termica";
  if (/^panela(?: de pressao)?\b/.test(text)) return "casa:panela";
  if (/^assadeira\b/.test(text)) return "casa:assadeira";
  if (/^copo (?!descartavel)\b/.test(text)) return "casa:copo";
  if (/^hamburguer misto\b/.test(text)) return "congelado:hamburguer-misto";

  return null;
}

export function offerReferenceFamiliesCompatible(
  left: string,
  right: string,
): boolean | null {
  const leftKey = offerReferenceFamilyKey(left);
  const rightKey = offerReferenceFamilyKey(right);

  if (!leftKey && !rightKey) return null;
  if (!leftKey || !rightKey) return false;
  return purchaseKeysCompatible(leftKey, rightKey);
}

export function offerReferenceRequiresKnownCount(familyKey: string | null) {
  if (!familyKey) return false;
  return (
    familyKey.startsWith("higiene:papel-higienico") ||
    familyKey.startsWith("limpeza:papel-toalha") ||
    familyKey === "higiene:toalha-umedecida" ||
    familyKey.startsWith("higiene:fralda-") ||
    familyKey === "cafe:capsula"
  );
}

function historicalPackage(product: ProductForMatch) {
  return product.package_size && product.unit
    ? inferPackage(`${product.package_size}${product.unit}`)
    : inferPackage(product.name);
}

export function findComparableProducts(
  candidate: FlyerCandidate,
  products: ProductForMatch[],
) {
  const candidateKey = purchaseComparisonKey(candidate.rawName);
  if (!candidateKey || !candidate.packageInfo) return [];

  return products.filter((product) => {
    const productKey = purchaseComparisonKey(product.name);
    if (!productKey || !purchaseKeysCompatible(candidateKey, productKey)) {
      return false;
    }

    const pkg = historicalPackage(product);
    if (
      !pkg ||
      pkg.baseUnit !== candidate.baseUnit ||
      !Number.isFinite(pkg.baseQuantity) ||
      pkg.baseQuantity <= 0
    ) {
      return false;
    }

    if (candidate.baseUnit === "un") {
      return Math.abs(pkg.baseQuantity - candidate.packageInfo!.baseQuantity) < 0.01;
    }

    return true;
  });
}

export function findComparablePurchaseProducts(
  candidate: FlyerCandidate,
  products: ProductForMatch[],
) {
  return findComparableProducts(candidate, products).filter(
    (product) => (product.prices ?? []).length > 0,
  );
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b), mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}

function normalizedHistorical(product: ProductForMatch, rawPrice: number | string) {
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const pkg = product.package_size && product.unit ? inferPackage(`${product.package_size}${product.unit}`) : inferPackage(product.name);
  return normalizedUnitPrice(price, pkg);
}

export function evaluateFlyerOffer(candidate: FlyerCandidate, product: ProductForMatch | null,
  previousAdvertised: Array<{
    normalized_price: number | string | null;
    advertised_price?: number | string | null;
    club_advertised_price?: number | string | null;
    package_quantity?: number | string | null;
    package_unit?: string | null;
    raw_name?: string | null;
    base_unit?: string | null;
    offer_notes?: string[] | null;
  }> = [],
  comparablePurchaseProducts: ProductForMatch[] = [],
): OfferVerdict {
  const purchaseSources = new Map<string, ProductForMatch>();
  if (product) purchaseSources.set(product.id, product);
  for (const comparable of comparablePurchaseProducts) {
    purchaseSources.set(comparable.id, comparable);
  }

  const purchases = [...purchaseSources.values()].flatMap((source) =>
    (source.prices ?? [])
      .map((entry) => normalizedHistorical(source, entry.price))
      .filter((entry) => entry?.baseUnit === candidate.baseUnit)
      .map((entry) => entry!.normalizedPrice),
  );
  const advertised = previousAdvertised
    .map((entry) => {
      const regularPrice = Number(entry.advertised_price);
      const clubPrice = Number(entry.club_advertised_price);
      const hasValidClub =
        Number.isFinite(clubPrice) &&
        clubPrice > 0 &&
        (!Number.isFinite(regularPrice) || regularPrice <= 0 || clubPrice <= regularPrice);
      const effectivePrice = hasValidClub ? clubPrice : regularPrice;

      const pkg = entry.raw_name
        ? offerPackageInfo(
            entry.raw_name,
            entry.package_quantity,
            entry.package_unit,
            entry.offer_notes,
            effectivePrice,
          )
        : packageInfoFromQuantity(
            entry.package_quantity,
            entry.package_unit,
          );

      if (pkg && Number.isFinite(effectivePrice) && effectivePrice > 0) {
        const normalized = normalizedUnitPrice(effectivePrice, pkg);
        return normalized.baseUnit === candidate.baseUnit
          ? normalized.normalizedPrice
          : null;
      }

      if (entry.base_unit !== candidate.baseUnit) return null;

      const storedNormalized = Number(entry.normalized_price);
      if (
        Number.isFinite(storedNormalized) &&
        storedNormalized > 0
      ) {
        if (
          hasValidClub &&
          Number.isFinite(regularPrice) &&
          regularPrice > 0
        ) {
          return storedNormalized * (clubPrice / regularPrice);
        }
        return storedNormalized;
      }

      return null;
    })
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value) && value > 0,
    );
  // A price the user actually paid is stronger evidence than an advertised
  // price. Use paid history first; fall back to older flyer offers only when
  // there is no comparable purchase history.
  // Current live offers must be excluded by the caller from previousAdvertised.
  const reference = purchases.length
    ? median(purchases)
    : median(advertised);
  if (!reference) return {
    key: "unknown",
    label: product ? "Pouco histórico" : "Novo no radar",
    message: product
      ? "O item foi relacionado, mas ainda não há uma referência comparável por unidade."
      : "Ainda não há preços anteriores comparáveis para este produto.",
    deltaPct: null,
    referencePrice: null,
    bestPurchase: purchases.length ? Math.min(...purchases) : null,
    bestAdvertised: advertised.length ? Math.min(...advertised) : null,
    purchaseCount: purchases.length,
    advertisedCount: advertised.length,
    confidence: "baixa",
  };

  const deltaPct = ((candidate.normalizedPrice - reference) / reference) * 100;
  const total = purchases.length + advertised.length;
  const confidence = purchases.length >= 3 || total >= 5 ? "alta" : total >= 2 ? "média" : "baixa";
  let key: OfferVerdict["key"] = "normal", label = "Na faixa", message = "O preço está próximo do seu histórico.";
  if (deltaPct <= -15) { key = "exceptional"; label = "Preço raro"; message = `Está ${Math.abs(deltaPct).toFixed(0)}% abaixo da sua referência. Priorize esta oferta.`; }
  else if (deltaPct <= -5) { key = "good"; label = "Vale a pena"; message = `Está ${Math.abs(deltaPct).toFixed(0)}% abaixo da sua referência histórica.`; }
  else if (deltaPct > 5) { key = "high"; label = "Já esteve melhor"; message = `Está ${deltaPct.toFixed(0)}% acima da sua referência. Se não for urgente, vale esperar.`; }

  return { key, label, message, deltaPct, referencePrice: reference,
    bestPurchase: purchases.length ? Math.min(...purchases) : null,
    bestAdvertised: advertised.length ? Math.min(...advertised) : null,
    purchaseCount: purchases.length, advertisedCount: advertised.length, confidence };
}
