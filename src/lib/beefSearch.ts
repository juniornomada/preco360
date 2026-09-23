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

const BROAD_PORK_QUERIES = new Set([
  "porco",
  "porcos",
  "suino",
  "suina",
  "suinos",
  "suinas",
  "porcino",
  "porcina",
  "porcinos",
  "porcinas",
  "carne porco",
  "carne suino",
  "carne suina",
  "carne porcino",
  "carne porcina",
  "carnes suinas",
  "carnes suinos",
]);

const BROAD_FISH_QUERIES = new Set([
  "peixe",
  "peixes",
  "pescado",
  "pescados",
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

export const PORK_SEMANTIC_TOKENS = [
  "carne",
  "carnes",
  "porco",
  "porcos",
  "suino",
  "suina",
  "suinos",
  "suinas",
  "porcino",
  "porcina",
  "porcinos",
  "porcinas",
] as const;

export const FISH_SEMANTIC_TOKENS = [
  "peixe",
  "peixes",
  "pescado",
  "pescados",
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

function normalizeBroadQuery(query: string) {
  return normalize(query)
    .split(" ")
    .filter((token) => token && !QUERY_STOP_WORDS.has(token))
    .join(" ");
}

export function isBroadBeefSearch(query: string) {
  return BROAD_BEEF_QUERIES.has(normalizeBroadQuery(query));
}

export function isBroadPorkSearch(query: string) {
  return BROAD_PORK_QUERIES.has(normalizeBroadQuery(query));
}

export function isBroadFishSearch(query: string) {
  return BROAD_FISH_QUERIES.has(normalizeBroadQuery(query));
}

const NON_BEEF_RE =
  /(^| )(suin[oa]s?|porcin[oa]s?|frango|ave|aves|peru)( |$)/;

const PROCESSED_MEAT_RE =
  /(^| )(hamburguer|almondega|linguica|salsicha|bacon|jerked|lasanha|pizza|sanduiche|kibe)( |$)/;

const BEEF_PRODUCT_HEAD_RE =
  /^(carne bovin[oa]s?|miolo do acem|acem|patinho|alcatra|maminha|paleta|bife de coxao (?:mole|duro)|coxao (?:mole|duro)|contra ?file|picanha|fraldinha|lagarto|cupim|costela bovin[oa]s?|costelao bovin[oa]s?|ponta de peito|peito bovino|capa de file|carne moida|file mignon|musculo|ossobuco|osso buco)( |$)/;

export function isBeefOfferText(value: string) {
  const normalized = normalize(value);
  if (!normalized) return false;
  if (NON_BEEF_RE.test(normalized) || PROCESSED_MEAT_RE.test(normalized)) {
    return false;
  }
  return BEEF_PRODUCT_HEAD_RE.test(normalized);
}

const NON_PORK_RE =
  /(^| )(bovin[oa]s?|ovin[oa]s?|cordeiro|cordeira|frango|ave|aves|peru|peixe|pescado|tilapia|merluza|linguado|panga|salmao|atum|sardinha|bacalhau|pacu|tambaqui|pintado|corvina|tainha|anchova|truta|pescada|pescadinha|cacao)( |$)/;

const PORK_PRODUCT_HEAD_RE =
  /^(carne suin[oa]s?|bisteca(?: da paleta)? suin[oa]|bisteca .* suin[oa]|file mignon suin[oa]|costela suin[oa]|costelinha suin[oa]|lombo suin[oa]|lombo\b|copa lombo(?: suin[oa])?|paleta suin[oa]|panceta(?: suin[oa])?|pernil(?: suin[oa])?|orelha suin[oa]|pe suin[oa]|pele suin[oa]|rabo suin[oa])( |$)/;

export function isPorkOfferText(value: string) {
  const normalized = normalize(value);
  if (!normalized) return false;
  if (NON_PORK_RE.test(normalized) || PROCESSED_MEAT_RE.test(normalized)) {
    return false;
  }
  return PORK_PRODUCT_HEAD_RE.test(normalized);
}

const FISH_SPECIES =
  "(?:tilapia|merluza|linguado|panga|salmao|atum|sardinha|bacalhau|pacu|tambaqui|pintado|corvina|tainha|anchova|truta|pescada|pescadinha|cacao)";

const FISH_PRODUCT_HEAD_RE = new RegExp(
  [
    "^(?:peixe|peixes|pescado|pescados)(?: |$)",
    `^(?:file|files) (?:de )?(?:peixe )?${FISH_SPECIES}(?: |$)`,
    `^file ${FISH_SPECIES}(?: |$)`,
    `^posta (?:de )?${FISH_SPECIES}(?: |$)`,
    `^costelinha (?:de )?(?:pacu|tambaqui)(?: |$)`,
    `^${FISH_SPECIES}(?: |$)`,
  ].join("|"),
);

export function isFishOfferText(value: string) {
  const normalized = normalize(value);
  if (!normalized) return false;
  return FISH_PRODUCT_HEAD_RE.test(normalized);
}
