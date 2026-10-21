export type VerifiedPackageUnit = "g" | "kg" | "ml" | "l";

export type VerifiedPackage = {
  package_size: number;
  unit: VerifiedPackageUnit;
};

/** Parse only dimensions explicitly confirmed by the consumer, never guess. */
export function verifiedPackageFromInput(
  rawSize: string | number | null | undefined,
  rawUnit: string | null | undefined,
): VerifiedPackage | null {
  const text = String(rawSize ?? "").trim();
  // Allow decimals like 1,25 kg or 0.75 L, but no thousands separators,
  // exponential formats, negative values or mixed currency strings.
  if (!/^\d{1,6}(?:[.,]\d{1,3})?$/.test(text)) return null;
  const size = Number(text.replace(",", "."));
  const unit = String(rawUnit ?? "").toLowerCase().trim();
  if (!["g", "kg", "ml", "l"].includes(unit)) return null;
  const maximum = unit === "g" || unit === "ml" ? 100000 : 1000;
  if (!Number.isFinite(size) || size <= 0 || size > maximum) return null;
  return { package_size: size, unit: unit as VerifiedPackageUnit };
}

export function hasVerifiedFiscalSaleWeight(unit?: string | null) {
  return ["KG", "G", "L", "ML"].includes(String(unit ?? "").toUpperCase());
}
