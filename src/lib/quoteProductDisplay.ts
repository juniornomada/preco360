type QuotePackageProduct = {
  id: string;
  name: string;
  package_size: number | string | null;
  unit: string | null;
};

/**
 * Package metadata is persisted in the database. Keep this adapter so callers
 * do not need a broad refactor, but never invent display-only package data.
 */
export function withVerifiedQuotePackage<T extends QuotePackageProduct>(product: T): T {
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
