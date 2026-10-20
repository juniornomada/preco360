/**
 * UI-only package metadata for exact, owner-confirmed catalog items whose
 * original NFC-e descriptions omitted the quantity. Does not write to DB.
 * Remove the exception after the guarded catalog migration is deployed.
 */
type QuotePackageProduct = {
  id: string;
  name: string;
  package_size: number | string | null;
  unit: string | null;
};

const VERIFIED_DA_FEIRA_ROLL_ID = "f05ca0d7-06b1-488e-bc36-0c6fdc45b283";

export function withVerifiedQuotePackage<T extends QuotePackageProduct>(product: T): T {
  if (
    product.id === VERIFIED_DA_FEIRA_ROLL_ID &&
    product.name.trim().toUpperCase() === "MASSA PASTEL DA FEIRA" &&
    product.package_size == null &&
    product.unit == null
  ) {
    return { ...product, package_size: 1, unit: "kg" };
  }
  return product;
}

/**
 * Never use the generic pasta/ready-meal visual for raw pastry roll dough.
 * A verified package photo still has priority when one is available.
 */
export function isPastryRollWithoutPhoto(name: string, imageUrl: string | null | undefined): boolean {
  if (imageUrl) return false;
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /^massa\s+(?:(?:para|de)\s+)?pastel\b/.test(normalized)
    || /^massa\s+p\s*\/\s*pastel\b/.test(normalized);
}
