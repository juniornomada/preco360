import { normalizeSearchText, normalizedUnitPrice, type FlyerCandidate, type PackageInfo } from "@/lib/flyerAnalysis";
import { inferFlyerPackage } from "@/lib/flyerUnits";
import { readFlyerFileSmart as readFlyerV5 } from "@/lib/flyerOcrV5";

const FRESH_TERMS = new Set([
  "abacate", "abacaxi", "abobora", "banana", "batata", "berinjela", "beterraba", "cenoura",
  "goiaba", "kiwi", "laranja", "limao", "maca", "mamao", "manga", "maracuja", "melancia",
  "melao", "pera", "repolho", "tomate", "uva",
]);

function words(value: string) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function isFreshProduce(value: string) {
  return words(value).some((word) => FRESH_TERMS.has(word));
}

function cleanSpaces(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, "").trim();
}

function stripOfferBasis(name: string, pkg: PackageInfo | null) {
  let cleaned = name
    .replace(/\bpre[cç]o\s*(?:a\s*)?cada\s*\d+(?:\s*[,\.]\s*\d+)?\s*(?:g|kg)\b/gi, " ")
    .replace(/\ba\s*cada\s*\d+(?:\s*[,\.]\s*\d+)?\s*(?:g|kg)\b/gi, " ");

  // For fresh produce, trailing "kg" is the sale basis, not part of the product name.
  if (isFreshProduce(cleaned) && pkg?.unit === "kg" && Math.abs(pkg.quantity - 1) < 0.001) {
    cleaned = cleaned.replace(/\bkg\b\s*$/i, " ");
  }

  // Produce sold "a cada 100g" should keep the 100g as the offer basis, while the
  // product identity remains just the produce name.
  if (isFreshProduce(cleaned) && pkg?.unit === "g" && Math.abs(pkg.quantity - 100) < 0.001) {
    cleaned = cleaned.replace(/\b100\s*g\b\s*$/i, " ");
  }

  return cleanSpaces(cleaned);
}

function rebuild(item: FlyerCandidate, rawName: string, pkgOverride?: PackageInfo | null): FlyerCandidate {
  const packageInfo = pkgOverride ?? inferFlyerPackage(rawName) ?? item.packageInfo;
  const normalized = normalizedUnitPrice(item.price, packageInfo);
  return {
    ...item,
    rawName: cleanSpaces(rawName),
    packageInfo,
    normalizedPrice: normalized.normalizedPrice,
    baseUnit: normalized.baseUnit,
  };
}

function splitSharedProduceOffer(item: FlyerCandidate) {
  const parts = item.rawName.split(/\s+ou\s+/i).map(cleanSpaces).filter(Boolean);
  if (parts.length !== 2 || !isFreshProduce(parts[0]) || !isFreshProduce(parts[1])) return [item];

  const sharedPackage = inferFlyerPackage(item.rawName) ?? item.packageInfo ?? {
    quantity: 1,
    unit: "kg" as const,
    baseUnit: "kg" as const,
    baseQuantity: 1,
  };

  return parts.map((part) => {
    const cleanName = stripOfferBasis(part, sharedPackage);
    return rebuild(item, cleanName, sharedPackage);
  });
}

function normalizeCandidate(item: FlyerCandidate) {
  // Re-read package quantity from original OCR text with decimal-safe parsing.
  // This fixes cases such as 1,35 L becoming 35 L.
  const packageInfo = inferFlyerPackage(item.rawName) ?? item.packageInfo;
  const basisCleanName = stripOfferBasis(item.rawName, packageInfo);
  return rebuild(item, basisCleanName, packageInfo);
}

function postProcess(items: FlyerCandidate[]) {
  const expanded = items.flatMap(splitSharedProduceOffer).map(normalizeCandidate);
  const seen = new Set<string>();
  return expanded.filter((item) => {
    if (!item.rawName || !Number.isFinite(item.price) || item.price <= 0) return false;
    if (!Number.isFinite(item.normalizedPrice) || item.normalizedPrice <= 0 || item.normalizedPrice > 1200) return false;
    const key = `${normalizeSearchText(item.rawName)}|${item.price.toFixed(2)}|${item.sourcePage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function readFlyerFileSmart(
  file: File,
  onProgress: (page: number, total: number, label: string) => void,
) {
  const result = await readFlyerV5(file, onProgress);
  const candidates = postProcess(result.candidates);
  return {
    ...result,
    candidates,
    textByPage: result.textByPage.map((text, pageIndex) => {
      const pageItems = candidates.filter((item) => (item.sourcePage ?? 1) === pageIndex + 1);
      return pageItems.length
        ? pageItems.map((item) => `${item.rawName} ${item.price.toFixed(2)}`).join("\n")
        : text;
    }),
  };
}
