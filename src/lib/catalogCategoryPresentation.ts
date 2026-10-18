import { classifyProductName } from "@/lib/productTaxonomy";

/**
 * Presentation-only fallback while historical rows still use "Geral".
 * Never overwrite an explicitly chosen category, and never display a
 * speculative category as certain. Taxonomy is not an identity key.
 */
export function displayCatalogCategory(name: string, existingCategory: string | null | undefined) {
  const manual = (existingCategory ?? "").trim();
  if (manual && manual.toLowerCase() !== "geral") return manual;
  const suggestion = classifyProductName(name);
  return suggestion?.confidence === "high" ? suggestion.category : (manual || "Geral");
}
