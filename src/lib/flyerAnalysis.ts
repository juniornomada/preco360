export type BaseUnit = "kg" | "l" | "un";

export type PackageInfo = {
  quantity: number;
  unit: "g" | "kg" | "ml" | "l" | "un";
  baseUnit: BaseUnit;
  baseQuantity: number;
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
};

export type ProductForMatch = {
  id: string;
  name: string;
  brand?: string | null;
  package_size?: number | null;
  unit?: string | null;
  stockable?: boolean | null;
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
  qj: "queijo", qjo: "queijo", muss: "mussarela", mussar: "mussarela",
  mozzarella: "mussarela", ling: "linguica", lingui: "linguica", tosc: "toscana",
  sobrec: "sobrecoxa", sobrecxa: "sobrecoxa", refri: "refrigerante", refr: "refrigerante",
  resf: "resfriado", cong: "congelado", bov: "bovina", suin: "suina",
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

function brandCompatible(candidate: FlyerCandidate, productTokens: string[]) {
  const brandTokens = candidate.brand ? tokens(candidate.brand) : [];
  if (!brandTokens.length) return true;
  return brandTokens.every((token) => productTokens.includes(token));
}

function identityCompatible(candidateTokens: string[], productTokens: string[]) {
  if (!candidateTokens.length || !productTokens.length) return false;
  const overlap = overlapCount(candidateTokens, productTokens);
  if (!overlap) return false;

  // A package size or a generic word must never be enough to relate different products.
  // For multi-word identities, require at least two meaningful shared tokens. Single-word
  // commodities such as "cenoura" remain matchable by exact category name.
  if (candidateTokens.length > 1 && productTokens.length > 1 && overlap < 2) return false;

  // If the leading product category differs, only allow it when there is otherwise
  // strong identity evidence (e.g. an abbreviated receipt with several matching terms).
  if (candidateTokens[0] !== productTokens[0] && overlap < 3) return false;

  return true;
}

function numberPt(value: string) {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

export function inferPackage(value: string): PackageInfo | null {
  const text = normalizeSearchText(value).replace(/(\d)\s+(kg|g|ml|l|lt|un|und|unid)\b/g, "$1$2");
  const multi = text.match(/\b(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lt)\b/i);
  if (multi) {
    const quantity = Number(multi[1]) * numberPt(multi[2]);
    const unit = (multi[3].toLowerCase() === "lt" ? "l" : multi[3].toLowerCase()) as PackageInfo["unit"];
    if (unit === "g") return { quantity, unit, baseUnit: "kg", baseQuantity: quantity / 1000 };
    if (unit === "kg") return { quantity, unit, baseUnit: "kg", baseQuantity: quantity };
    if (unit === "ml") return { quantity, unit, baseUnit: "l", baseQuantity: quantity / 1000 };
    return { quantity, unit: "l", baseUnit: "l", baseQuantity: quantity };
  }

  const match = text.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|quilo|quilos|g|grama|gramas|ml|l|lt|litro|litros|un|und|unid|unidade|unidades)\b/i);
  if (match) {
    const quantity = numberPt(match[1]);
    const unit = match[2].toLowerCase();
    if (["g", "grama", "gramas"].includes(unit)) return { quantity, unit: "g", baseUnit: "kg", baseQuantity: quantity / 1000 };
    if (["kg", "quilo", "quilos"].includes(unit)) return { quantity, unit: "kg", baseUnit: "kg", baseQuantity: quantity };
    if (unit === "ml") return { quantity, unit: "ml", baseUnit: "l", baseQuantity: quantity / 1000 };
    if (["l", "lt", "litro", "litros"].includes(unit)) return { quantity, unit: "l", baseUnit: "l", baseQuantity: quantity };
    return { quantity, unit: "un", baseUnit: "un", baseQuantity: quantity };
  }

  if (/\b(kg|quilo|quilos)\b/.test(text)) return { quantity: 1, unit: "kg", baseUnit: "kg", baseQuantity: 1 };
  if (/\b(litro|litros|lt)\b/.test(text)) return { quantity: 1, unit: "l", baseUnit: "l", baseQuantity: 1 };
  if (/\b(unidade|unidades|und|unid)\b/.test(text)) return { quantity: 1, unit: "un", baseUnit: "un", baseQuantity: 1 };
  return null;
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
    (!item.retailer || !retailer || normalizeSearchText(item.retailer) === normalizeSearchText(retailer)));
  if (alias) return { productId: alias.product_id, confidence: 1, type: "exact" as const };

  const candidateTokens = tokens(candidate.rawName);
  let best: { id: string; score: number } | null = null;

  for (const product of products) {
    const productTokens = tokens(`${product.name} ${product.brand ?? ""}`);
    if (!identityCompatible(candidateTokens, productTokens)) continue;
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
  previousAdvertised: Array<{ normalized_price: number | string | null; base_unit?: string | null }> = []): OfferVerdict {
  if (!product) return { key: "unknown", label: "Novo no radar", message: "Ainda não encontrei um produto equivalente no seu histórico.",
    deltaPct: null, referencePrice: null, bestPurchase: null, bestAdvertised: null, purchaseCount: 0, advertisedCount: 0, confidence: "baixa" };

  const purchases = (product.prices ?? []).map((entry) => normalizedHistorical(product, entry.price))
    .filter((entry) => entry?.baseUnit === candidate.baseUnit).map((entry) => entry!.normalizedPrice);
  const advertised = previousAdvertised.filter((entry) => entry.base_unit === candidate.baseUnit)
    .map((entry) => Number(entry.normalized_price)).filter((value) => Number.isFinite(value) && value > 0);
  const reference = median(purchases) ?? median(advertised);
  if (!reference) return { key: "unknown", label: "Pouco histórico", message: "O item foi relacionado, mas ainda não há uma referência comparável por unidade.",
    deltaPct: null, referencePrice: null, bestPurchase: purchases.length ? Math.min(...purchases) : null,
    bestAdvertised: advertised.length ? Math.min(...advertised) : null, purchaseCount: purchases.length,
    advertisedCount: advertised.length, confidence: "baixa" };

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
