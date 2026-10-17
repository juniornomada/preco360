/**
 * Compound search intent: match only verified preparation/package attributes.
 * A missing preparation in a flyer is UNKNOWN, never evidence of freshness.
 */
function fold(text: string) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type FishPreparation = "fresh" | "frozen" | "mixed" | "unknown";

export function requestedFishPreparation(query: string): "fresh" | "frozen" | null {
  const text = fold(query);
  if (!/\b(?:peixe|peixes|pescado|pescados)\b/.test(text)) return null;
  const frozen = /\b(?:congelad[oa]s?|ultracongelad[oa]s?)\b/.test(text);
  const fresh = /\b(?:fresc[oa]s?|resfriad[oa]s?)\b/.test(text);
  if (fresh === frozen) return null;
  return frozen ? "frozen" : "fresh";
}

export function fishOfferPreparation(name: string): FishPreparation {
  const text = fold(name);
  const frozen = /\b(?:congelad[oa]s?|ultracongelad[oa]s?)\b/.test(text);
  const fresh = /\b(?:fresc[oa]s?|resfriad[oa]s?)\b/.test(text);
  if (frozen && fresh) return "mixed";
  if (frozen) return "frozen";
  if (fresh) return "fresh";
  return "unknown";
}

export function matchesFishPreparation(name: string, query: string) {
  const kind = requestedFishPreparation(query);
  return !kind || fishOfferPreparation(name) === kind;
}

const cornDerivative = /\b(?:curau|cural|pamonha|pamonhas|suco|sucos|bolo|bolos|pao|paes|farinha|farofa|farofas|flocao|amido|mingau|canjica|polenta|cuscuz)\b/;

export function isCornDerivedProduct(value: string) {
  const text = fold(value);
  // Curau and pamonha are inherently corn preparations; no qualifier needed.
  if (/^(?:curau|pamonha|pamonhas)\b/.test(text)) return true;
  return /\bmilho\b/.test(text) && cornDerivative.test(text);
}

export function isCornDerivedQuery(value: string) {
  const text = fold(value);
  return /\bmilho\b/.test(text) && cornDerivative.test(text);
}


export function isCoffeeCapsuleProduct(name: string) {
  const text = fold(name);
  const hasCoffee = /\bcafe\b/.test(text);
  const hasCapsule = /\b(?:caps|capsula|capsulas)\b/.test(text);
  return hasCoffee && hasCapsule &&
    /^(?:cafe|caps|capsula|capsulas)\b/.test(text);
}
