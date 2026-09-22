const QUERY_STOP_WORDS = new Set(["de", "da", "do", "das", "dos"]);

const BROAD_BEEF_QUERIES = new Set([
  "boi",
  "bovino",
  "bovina",
  "bovinos",
  "bovinas",
  "carne boi",
  "carne bovino",
  "carne bovina",
  "carne bovinos",
  "carne bovinas",
  "carnes bovinas",
  "carnes bovinos",
]);

export const BEEF_SEMANTIC_TOKENS = [
  "carne",
  "carnes",
  "boi",
  "bovino",
  "bovina",
  "bovinos",
  "bovinas",
] as const;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isBroadBeefSearch(query: string) {
  const normalized = normalize(query);
  if (!normalized) return false;

  const withoutStopWords = normalized
    .split(" ")
    .filter((token) => token && !QUERY_STOP_WORDS.has(token))
    .join(" ");

  return BROAD_BEEF_QUERIES.has(withoutStopWords);
}

const NON_BEEF_RE =
  /(^| )(suin[oa]s?|porcin[oa]s?|frango|ave|aves|peru)( |$)/;

const PROCESSED_RE =
  /(^| )(hamburguer|almondega|linguica|salsicha|bacon|lasanha|pizza|sanduiche|kibe)( |$)/;

const BEEF_PRODUCT_HEAD_RE =
  /^(carne bovin[oa]s?|miolo do acem|acem|patinho|alcatra|maminha|paleta|bife de coxao (?:mole|duro)|coxao (?:mole|duro)|contra ?file|picanha|fraldinha|lagarto|cupim|costela bovin[oa]s?|costelao bovin[oa]s?|ponta de peito|peito bovino|capa de file|carne moida|file mignon|musculo|ossobuco|osso buco)( |$)/;

export function isBeefOfferText(value: string) {
  const normalized = normalize(value);
  if (!normalized) return false;
  if (NON_BEEF_RE.test(normalized) || PROCESSED_RE.test(normalized)) {
    return false;
  }
  return BEEF_PRODUCT_HEAD_RE.test(normalized);
}
