function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function prioritizeKgPrice(
  family: string | null | undefined,
  rawName: string,
  baseUnit: string | null | undefined,
) {
  if (baseUnit !== "kg") return false;

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
