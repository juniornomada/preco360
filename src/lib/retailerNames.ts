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
  if (/\bswift\b/.test(normalized)) return "Swift";
  if (/\bconfianca\b/.test(normalized)) {
    // Preserve distinct branches: grouping Aquarius with Esmeralda would
    // incorrectly conflate stores and purchase history.
    if (/\besmeralda\b/.test(normalized)) return "Confiança Esmeralda";
    if (/\baquarius\b/.test(normalized)) return "Confiança Aquarius";
    return "Confiança";
  }
  if (/\btauste\b/.test(normalized)) return "Tauste";
  if (/\bmax atacadista\b/.test(normalized)) return "Max Atacadista";
  if (/\batacadao\b/.test(normalized)) return "Atacadão";
  if (/\bemporio galdencio\b/.test(normalized)) return "Empório Galdêncio";

  return original;
}


/**
 * One readable presentation style across historical prices and new entries.
 * Do not mutate legacy price records merely to change capitalization.
 * Unknown legal names remain distinct, with acronyms/Portuguese connectors
 * retained, so unrelated chains are never joined just by their spelling.
 */
export function displayRetailerName(value?: string | null): string {
  const original = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!original) return original;
  const canonical = canonicalRetailerName(original);
  if (canonical !== original) return canonical;

  const connectors = new Set(["e", "de", "da", "do", "dos", "das"]);
  const legalAcronyms = new Set(["sa", "s.a.", "me", "epp", "mei", "ltda", "cnpj"]);
  const words = original.split(" ");

  return words.map((word, index) => {
    const lowercase = word.toLocaleLowerCase("pt-BR");
    const normalized = lowercase.replace(/[^a-z.]/g, "");
    if (index > 0 && connectors.has(lowercase)) return lowercase;
    if (normalized === "s.a." || normalized === "sa" && word === "SA") return "S.A.";
    if (normalized === "ltda") return "Ltda";
    if (legalAcronyms.has(normalized) && normalized !== "ltda") return normalized.toUpperCase();
    // Retain established short capitalized acronyms, not a whole caps name.
    if (/^[A-Z]{2,3}$/.test(word) && !connectors.has(lowercase)) return word;
    return lowercase.replace(/(^|[-'’])([\p{L}])/gu, (_match, prefix: string, letter: string) =>
      prefix + letter.toLocaleUpperCase("pt-BR"),
    );
  }).join(" ");
}

export function retailerLogoPath(value?: string | null) {
  const canonical = canonicalRetailerName(value);

  switch (canonical) {
    case "Tauste":
      return "/retailer-logos/tauste.webp";
    case "Kawakami":
      return "/retailer-logos/kawakami-user-provided.png";
    case "Swift":
      return "/retailer-logos/swift.svg";
    case "Confiança":
    case "Confiança Esmeralda":
    case "Confiança Aquarius":
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
