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
