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

export function prioritizeKgPrice(
  family: string | null | undefined,
  rawName: string,
  baseUnit: string | null | undefined,
) {
  if (baseUnit !== "kg") return false;

  if (family === "fish" && isCannedFishOffer(rawName)) {
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
