function normalizedRetailerName(value?: string | null) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalRetailerName(value?: string | null) {
  const original = String(value ?? "").trim();
  if (!original) return original;

  const normalized = normalizedRetailerName(original);

  if (/\bkawakami\b/.test(normalized)) return "Kawakami";
  if (/\bconfianca\b/.test(normalized)) return "Confiança";
  if (/\btauste\b/.test(normalized)) return "Tauste";
  if (/\bmax atacadista\b/.test(normalized)) return "Max Atacadista";
  if (/\batacadao\b/.test(normalized)) return "Atacadão";
  if (/\bemporio galdencio\b/.test(normalized)) return "Empório Galdêncio";

  return original;
}

export function retailerLogoPath(value?: string | null) {
  const canonical = canonicalRetailerName(value);

  switch (canonical) {
    case "Tauste":
      return "/retailer-logos/tauste.webp";
    case "Kawakami":
      return "/retailer-logos/kawakami.webp";
    case "Confiança":
      return "/retailer-logos/confianca.webp";
    case "Max Atacadista":
      return "/retailer-logos/max-atacadista.webp";
    case "Atacadão":
      return "/retailer-logos/atacadao.webp";
    case "Empório Galdêncio":
      return "/retailer-logos/emporio-galdencio.webp";
    default:
      return null;
  }
}
