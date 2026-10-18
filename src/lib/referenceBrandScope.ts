const normalizeSearchText = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type ReferenceSample = {
  value: number;
  brand?: string | null;
  name?: string | null;
};

export type HistoricalReferenceProvenance = {
  referenceScope: "same_brand" | "category";
  referenceSource: "purchase" | "offer";
  referenceSampleCount: number;
  referenceBrands: string[];
};

const normalizedBrand = (brand: string | null | undefined) =>
  normalizeSearchText(brand ?? "").replace(/\b(?:industria|alimentos)\b/g, "").trim();

/** Positive proof of a same-brand match is required. Unknown brands never become "same brand". */
function explicitlyMatchesBrand(candidateBrand: string, reference: ReferenceSample) {
  if (!candidateBrand) return false;
  const sourceBrand = normalizedBrand(reference.brand);
  if (sourceBrand) return sourceBrand === candidateBrand;
  const name = " " + normalizeSearchText(reference.name ?? "") + " ";
  return name.includes(" " + candidateBrand + " ");
}

/**
 * Prefer directly comparable same-brand evidence before category evidence.
 * Within the selected scope, purchases beat advertised prices.
 * Never silently pool purchases from another brand into a "same brand" history.
 */
export function chooseHistoricalReference(
  candidateBrand: string | null | undefined,
  purchases: ReferenceSample[],
  offers: ReferenceSample[],
): { samples: ReferenceSample[]; provenance: HistoricalReferenceProvenance } | null {
  const brand = normalizedBrand(candidateBrand);
  const valid = (sample: ReferenceSample) => Number.isFinite(sample.value) && sample.value > 0;
  const paid = purchases.filter(valid);
  const advertised = offers.filter(valid);
  const samePaid = brand ? paid.filter(sample => explicitlyMatchesBrand(brand, sample)) : [];
  const sameOffers = brand ? advertised.filter(sample => explicitlyMatchesBrand(brand, sample)) : [];
  // A single price is not sufficient to assert "SIM" or "NÃO".
  // Prefer a benchmark with 2+ observations, prioritizing same-brand data,
  // then category data. Do not hide four comparable offers behind one receipt.
  const candidates = [
    { samples: samePaid, scope: "same_brand" as const, source: "purchase" as const },
    { samples: sameOffers, scope: "same_brand" as const, source: "offer" as const },
    { samples: paid, scope: "category" as const, source: "purchase" as const },
    { samples: advertised, scope: "category" as const, source: "offer" as const },
  ];
  const selected = candidates.find(candidate => candidate.samples.length >= 2)
    ?? candidates.find(candidate => candidate.samples.length > 0);
  if (!selected) return null;
  const {samples} = selected;

  const brands = [...new Map(samples
    .filter(sample => !!sample.brand?.trim())
    .map(sample => [normalizedBrand(sample.brand),sample.brand!.trim()] as const))
    .entries()]
    .filter(([normalized]) => !!normalized)
    .map(([,label]) => label);

  return {
    samples,
    provenance: {
      referenceScope: selected.scope,
      referenceSource: selected.source,
      referenceSampleCount: samples.length,
      referenceBrands: brands,
    },
  };
}

export function historicalReferenceScopeLabel(
  provenance: HistoricalReferenceProvenance,
): string {
  const source = provenance.referenceSource === "purchase"
    ? "compra" : "oferta";
  const count = provenance.referenceSampleCount;
  const brands = provenance.referenceBrands.length
    ? " (" + provenance.referenceBrands.slice(0,2).join(", ") +
      (provenance.referenceBrands.length>2 ? " e outras" : "") + ")"
    : "";
  return provenance.referenceScope === "same_brand"
    ? "Mesma marca · mediana de " + count + " " + source + (count===1?"":"s") + " anterior" + (count===1?"":"es")
    : "Categoria · mediana de " + count + " " + source + (count===1?"":"s") + " anterior" + (count===1?"":"es") + brands;
}
