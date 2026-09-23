function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const CANNED_FISH_HEAD_RE = /^(atum|sardinha)( |$)/;
const CANNED_FISH_HINT_RE =
  /(^| )(lata|latas|solido|solida|natural|ralado|ralada|pedaco|pedacos|oleo|agua|molho|escabeche|conserva|tipos?)( |$)/;
const FRESH_FISH_HINT_RE =
  /(^| )(fresco|fresca|resfriado|resfriada|congelado|congelada|file|files|posta|postas|inteiro|inteira)( |$)/;

function cannedFishSpecies(rawName: string) {
  const match = normalize(rawName).match(/^(atum|sardinha)( |$)/);
  return match?.[1] ?? null;
}

function massInGrams(
  rawName: string,
  packageQuantity?: number | string | null,
  packageUnit?: string | null,
) {
  const quantity = Number(packageQuantity);
  const unit = normalize(packageUnit ?? "");

  if (Number.isFinite(quantity) && quantity > 0) {
    if (unit === "g") return quantity;
    if (unit === "kg") return quantity * 1000;
  }

  const match = normalize(rawName).match(/\b(\d+(?:[.,]\d+)?)\s*(kg|g)\b/);
  if (!match) return null;
  const parsed = Number(match[1].replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return match[2] === "kg" ? parsed * 1000 : parsed;
}

export function isCannedFishOffer(rawName: string) {
  const text = normalize(rawName);
  if (!CANNED_FISH_HEAD_RE.test(text)) return false;
  if (FRESH_FISH_HINT_RE.test(text)) return false;
  if (CANNED_FISH_HINT_RE.test(text)) return true;

  // Some tabloids omit "lata" and even the preparation ("sólido", "óleo" etc.),
  // leaving only the species + the small retail pack size.
  const grams = text.match(/\b(\d+(?:[.,]\d+)?)\s*g\b/);
  if (!grams) return false;
  const quantity = Number(grams[1].replace(",", "."));
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 250;
}

export function comparableCannedFishOffers(
  leftRawName: string,
  leftPackageQuantity?: number | string | null,
  leftPackageUnit?: string | null,
  rightRawName?: string,
  rightPackageQuantity?: number | string | null,
  rightPackageUnit?: string | null,
) {
  if (!rightRawName) return false;
  if (!isCannedFishOffer(leftRawName) || !isCannedFishOffer(rightRawName)) {
    return false;
  }

  if (cannedFishSpecies(leftRawName) !== cannedFishSpecies(rightRawName)) {
    return false;
  }

  const leftGrams = massInGrams(
    leftRawName,
    leftPackageQuantity,
    leftPackageUnit,
  );
  const rightGrams = massInGrams(
    rightRawName,
    rightPackageQuantity,
    rightPackageUnit,
  );

  if (leftGrams === null || rightGrams === null) return false;

  // Canned fish is bought by the package, so historical references must be
  // the same retail pack size. This avoids treating 140 g and 170 g cans as
  // interchangeable just because both normalize to R$/kg.
  return Math.abs(leftGrams - rightGrams) < 0.5;
}

export function prioritizeKgPrice(
  family: string | null | undefined,
  rawName: string,
  baseUnit: string | null | undefined,
) {
  if (baseUnit !== "kg") return false;

  if ((family === "fish" || family === "cannedFish") && isCannedFishOffer(rawName)) {
    return false;
  }

  if (family === "beef" || family === "pork" || family === "fish") {
    return true;
  }

  const text = normalize(rawName);
  return /^(frango|galeto|coxa de frango|sobrecoxa|peito de frango|sassami|asa de frango|tulipa de frango|coracao de frango)( |$)/.test(text);
}

export function packagePriceIsMeaningfullyDifferent(
  packagePrice: number,
  normalizedKgPrice: number,
) {
  if (!Number.isFinite(packagePrice) || !Number.isFinite(normalizedKgPrice)) {
    return false;
  }
  if (packagePrice <= 0 || normalizedKgPrice <= 0) return false;

  return Math.abs(packagePrice - normalizedKgPrice) >= 0.01;
}
