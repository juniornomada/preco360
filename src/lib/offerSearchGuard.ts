import { normalizeSearchText } from "@/lib/flyerAnalysis";

export function isGenericSugarSearch(query: string) {
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["de", "da", "do", "das", "dos", "em"].includes(token));

  return (
    tokens.length === 1 &&
    (tokens[0] === "acucar" || tokens[0] === "acucares")
  );
}

export function isSugarProductName(value: string) {
  const normalized = normalizeSearchText(value).trim();
  return /^acucar(?:es)?\b/.test(normalized);
}


export function isGenericSaltSearch(query: string) {
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["de", "da", "do", "das", "dos", "em"].includes(token));

  return tokens.length === 1 && tokens[0] === "sal";
}

export function isSaltProductName(value: string) {
  const normalized = normalizeSearchText(value).trim();
  return /^sal\b/.test(normalized);
}


export const PONCA_SEARCH_VARIANTS = [
  "ponca",
  "poncan",
  "poncam",
  "ponka",
  "ponkan",
  "ponkam",
  "poca",
  "pocan",
  "pocam",
  "pokan",
  "pokam",
] as const;

const poncaSearchVariantSet = new Set<string>(PONCA_SEARCH_VARIANTS);

export function normalizePoncaSearchToken(value: string) {
  const normalized = normalizeSearchText(value).trim();
  return poncaSearchVariantSet.has(normalized) ? "poncan" : normalized;
}

/**
 * Keep all catalog/search aliases unified internally, but present the fruit
 * under the user-facing spelling "Ponkan" (capital P).
 * This does not mutate saved product names or offer data.
 */
export function displayPonkanQuery(query: string) {
  return isGenericPoncaSearch(query) ? "Ponkan" : query;
}

export function displayPonkanProductName(name: string) {
  return name.replace(
    /(^|[^a-zA-ZÀ-ÿ0-9])(?:poncã|ponca|poncan|poncam|ponka|ponkan|ponkam|poca|pocan|pocam|pokan|pokam)(?=$|[^a-zA-ZÀ-ÿ0-9])/gi,
    (_found, before: string) => before + "Ponkan",
  );
}

export function isGenericPoncaSearch(query: string) {
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["de", "da", "do", "das", "dos", "em"].includes(token));

  return tokens.length === 1 && poncaSearchVariantSet.has(tokens[0]);
}



export function isGenericStrawberrySearch(query: string) {
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["de", "da", "do", "das", "dos", "em"].includes(token));

  return (
    tokens.length === 1 &&
    (tokens[0] === "morango" || tokens[0] === "morangos")
  );
}

export function isStrawberryProductName(value: string) {
  const normalized = normalizeSearchText(value).trim();
  return /^morangos?\b/.test(normalized);
}

const powderedDrinkTerms = new Set(["suco", "sucos", "refresco", "refrescos"]);

export function isPowderedDrinkSearch(query: string) {
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["de", "da", "do", "das", "dos", "em"].includes(token));

  return (
    tokens.includes("po") &&
    tokens.some((token) => powderedDrinkTerms.has(token))
  );
}

export function powderedDrinkSearchRequests(query: string) {
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["de", "da", "do", "das", "dos", "em"].includes(token));

  if (
    !tokens.includes("po") ||
    !tokens.some((token) => powderedDrinkTerms.has(token))
  ) {
    return [tokens.join(" ")];
  }

  return [...new Set(
    ["suco", "refresco"].map((familyTerm) =>
      tokens
        .map((token) => (powderedDrinkTerms.has(token) ? familyTerm : token))
        .join(" "),
    ),
  )];
}
