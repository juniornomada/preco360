function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

export type ChickenKind =
  | "chickenWhole" | "chickenBreastBone" | "chickenBreastBoneless"
  | "chickenBreastUnknown" | "chickenBreastFillet" | "chickenTenderloin"
  | "chickenDrumstick" | "chickenThigh" | "chickenLegQuarter"
  | "chickenWing" | "chickenShredded" | "chickenRoasted"
  | "chickenBreaded" | "chickenOther";

export type ChickenIntent = ChickenKind | "chicken";
const chickenTerms = /\b(?:frango|frangos|franguinho|ave|aves|galinha|sassami)\b/;
const breastTerms = /\b(?:peito|peitos)\b/;
const portionTerms = /\b(?:coxa|coxas|sobrecoxa|sobrecoxas|asa|asas|file|files|filezinho|filezinhos|sassami|inteiro|inteira|desfiado|desfiada|assado|assada)\b/;

export function chickenKind(value: string): ChickenKind | null {
  const n = normalizeSearchText(value);
  // Do not mistake turkey breast, beef filet or generic frozen foods for chicken.
  if (!chickenTerms.test(n)) return null;
  if (/\b(?:peru|bovino|suino|peixe|tilapia)\b/.test(n)) return null;
  if (/\b(?:empanado|empanada|nugget|nuggets)\b/.test(n)) return "chickenBreaded";
  if (/\b(?:desfiad[oa]s?)\b/.test(n)) return "chickenShredded";
  if (/\b(?:assad[oa]s?)\b/.test(n)) return "chickenRoasted";
  if (/\b(?:sassami|filezinhos?|filetinhos?)\b/.test(n)) return "chickenTenderloin";
  if (/\b(?:coxa|coxas)\b.*\b(?:sobrecoxa|sobrecoxas)\b|\b(?:sobrecoxa|sobrecoxas)\b.*\b(?:coxa|coxas)\b/.test(n)) return "chickenLegQuarter";
  if (/\b(?:sobrecoxa|sobrecoxas)\b/.test(n)) return "chickenThigh";
  if (/\b(?:coxa|coxas)\b/.test(n)) return "chickenDrumstick";
  if (/\b(?:asa|asas|meio da asa|tulipa)\b/.test(n)) return "chickenWing";
  if (breastTerms.test(n)) {
    if (/\b(?:file|files)\b/.test(n)) return "chickenBreastFillet";
    if (/\b(?:sem osso|s osso|desossad[oa]s?)\b/.test(n)) return "chickenBreastBoneless";
    if (/\b(?:com osso|c osso)\b/.test(n)) return "chickenBreastBone";
    return "chickenBreastUnknown";
  }
  if (/\b(?:file|files)\b/.test(n)) return "chickenBreastFillet";
  if (/\b(?:inteir[oa]s?)\b/.test(n)) return "chickenWhole";
  // An unnamed "frango congelado" is not necessarily an entire bird.
  return "chickenOther";
}

export const chickenKinds: ChickenKind[] = [
  "chickenWhole", "chickenBreastBone", "chickenBreastBoneless",
  "chickenBreastUnknown", "chickenBreastFillet", "chickenTenderloin",
  "chickenDrumstick", "chickenThigh", "chickenLegQuarter", "chickenWing",
  "chickenShredded", "chickenRoasted", "chickenBreaded", "chickenOther",
];

export const chickenLabels: Record<ChickenKind,string> = {
  chickenWhole:"Frango inteiro",
  chickenBreastBone:"Peito de frango com osso",
  chickenBreastBoneless:"Peito de frango sem osso",
  chickenBreastUnknown:"Peito de frango (osso não informado)",
  chickenBreastFillet:"Filé de peito de frango",
  chickenTenderloin:"Filézinho / sassami",
  chickenDrumstick:"Coxa de frango",
  chickenThigh:"Sobrecoxa de frango",
  chickenLegQuarter:"Coxa e sobrecoxa",
  chickenWing:"Asa de frango",
  chickenShredded:"Frango desfiado",
  chickenRoasted:"Frango assado",
  chickenBreaded:"Frango empanado",
  chickenOther:"Frango (corte não identificado)",
};

export function chickenQueryIntent(query: string): ChickenIntent | null {
  const n = normalizeSearchText(query);
  if (!chickenTerms.test(n)) return null;
  // An explicit cut, even with no source brand, is a narrow product request.
  if (!portionTerms.test(n)) return "chicken";
  const kind = chickenKind(query);
  return kind ?? "chicken";
}

export type MeatPreparation = "frozen" | "fresh" | "mixed" | "unknown";

export function meatPreparation(name: string): MeatPreparation {
  const n = normalizeSearchText(name);
  const frozen = /\b(?:congelad[oa]s?|ultracongelad[oa]s?)\b/.test(n);
  const fresh = /\b(?:fresc[oa]s?|resfriad[oa]s?)\b/.test(n);
  return frozen && fresh ? "mixed" : frozen ? "frozen" : fresh ? "fresh" : "unknown";
}

export function requestedChickenPreparation(query:string): "frozen" | "fresh" | null {
  if (!chickenQueryIntent(query)) return null;
  const p=meatPreparation(query);
  return p==="frozen"||p==="fresh"?p:null;
}

export function chickenComparableKey(name:string) {
  const kind=chickenKind(name);
  return kind ? kind+":"+meatPreparation(name) : null;
}
