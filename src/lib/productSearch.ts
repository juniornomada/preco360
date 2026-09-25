const TOKEN_ALIASES: Record<string, string> = {
  qj: "queijo",
  qjo: "queijo",
  mus: "mussarela",
  muss: "mussarela",
  mussar: "mussarela",
  mozzarella: "mussarela",
  refri: "refrigerante",
  refr: "refrigerante",
  ponca: "ponca",
  poncan: "ponca",
  poncam: "ponca",
  ponka: "ponca",
  ponkan: "ponca",
  ponkam: "ponca",
  poca: "ponca",
  pocan: "ponca",
  pocam: "ponca",
  pokan: "ponca",
  pokam: "ponca",
};

const STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "em"]);

function stripAccents(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeProductSearchText(value: string) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/\b(?:zero|0\s*[.,]?\s*0?)\s*%?\s*alcool\b/g, "sem alcool")
    .replace(/\balcool\s+(?:zero|0\s*[.,]?\s*0?)\b/g, "sem alcool")
    .replace(/\bsem\s+alcool\b/g, "sem alcool")
    .replace(/\b(?:suco|refresco)\s+em\s+po\b/g, "refresco em po")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function productSearchTokens(value: string) {
  const normalized = normalizeProductSearchText(value);
  if (!normalized) return [];

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => !STOP_WORDS.has(token));
}

export function productMatchesSearch(text: string, query: string) {
  const queryTokens = productSearchTokens(query);
  if (!queryTokens.length) return true;

  const textTokens = productSearchTokens(text);

  return queryTokens.every((queryToken) =>
    textTokens.some((textToken) => {
      // Exact matches and fuller product tokens are safe. Do not allow the
      // reverse substring check for tiny tokens such as the unit "l":
      // otherwise "5 L" incorrectly matches searches like "leite".
      if (
        textToken === queryToken ||
        textToken.includes(queryToken)
      ) {
        return true;
      }

      return (
        queryToken.length >= 4 &&
        textToken.length >= 3 &&
        queryToken.startsWith(textToken)
      );
    }),
  );
}

export function productSearchRequestVariants(value: string) {
  const canonical = normalizeProductSearchText(value);
  if (!canonical) return [];

  const variants = new Set<string>([canonical]);

  if (canonical.includes("sem alcool")) {
    variants.add(canonical.replace(/\bsem alcool\b/g, "zero alcool"));
    variants.add(canonical.replace(/\bsem alcool\b/g, "0 0 alcool"));
  }

  if (canonical.includes("refresco em po")) {
    variants.add(canonical.replace(/\brefresco em po\b/g, "suco em po"));
  }

  return [...variants];
}
