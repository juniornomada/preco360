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

export function inferPackage(value: string): PackageInfo | null {
  const text = normalizeSearchText(value)
    .replace(/\b([a-z]{3,})(kg|ml)\b/g, "$1 $2")
    .replace(/(\d)\s+(kg|g|ml|l|lt|un|und|unid)\b/g, "$1$2");
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

  return null;
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

function historicalPackage(product: ProductForMatch) {
  return product.package_size && product.unit
    ? inferPackage(`${product.package_size}${product.unit}`)
    : inferPackage(product.name);
}

export function findComparablePurchaseProducts(
  candidate: FlyerCandidate,
  products: ProductForMatch[],
) {
  const candidateKey = purchaseComparisonKey(candidate.rawName);
  if (!candidateKey || !candidate.packageInfo) return [];

  return products.filter((product) => {
    if (!(product.prices ?? []).length) return false;

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
    .filter((entry) => entry.base_unit === candidate.baseUnit)
    .map((entry) => {
      const regularPrice = Number(entry.advertised_price);
      const clubPrice = Number(entry.club_advertised_price);
      const hasValidClub =
        Number.isFinite(clubPrice) &&
        clubPrice > 0 &&
        (!Number.isFinite(regularPrice) || regularPrice <= 0 || clubPrice <= regularPrice);

      if (hasValidClub) {
        const pkg =
          entry.package_quantity && entry.package_unit
            ? inferPackage(`${entry.package_quantity}${entry.package_unit}`)
            : entry.raw_name
              ? inferPackage(entry.raw_name)
              : null;
        if (pkg) {
          return normalizedUnitPrice(clubPrice, pkg).normalizedPrice;
        }

        const storedNormalized = Number(entry.normalized_price);
        if (
          Number.isFinite(storedNormalized) &&
          storedNormalized > 0 &&
          Number.isFinite(regularPrice) &&
          regularPrice > 0
        ) {
          return storedNormalized * (clubPrice / regularPrice);
        }
      }

      return Number(entry.normalized_price);
    })
    .filter((value) => Number.isFinite(value) && value > 0);
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
