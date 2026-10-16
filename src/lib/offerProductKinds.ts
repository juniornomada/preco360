import { normalizeSearchText } from "@/lib/flyerAnalysis";

export type MilkProductKind =
  | "milkLiquid"
  | "milkPowder"
  | "milkCream"
  | "milkCondensed"
  | "milkFermented"
  | "milkCoconut"
  | "milkSweet";

export function milkProductKind(value: string): MilkProductKind | null {
  const n = normalizeSearchText(value);
  if (/^creme de leite\b/.test(n)) return "milkCream";
  if (/^doce de leite\b/.test(n)) return "milkSweet";
  if (!/^leite\b/.test(n)) return null;
  if (/^leite (?:condensado|cond)\b/.test(n)) return "milkCondensed";
  if (/^leite (?:fermentado|ferm)\b/.test(n)) return "milkFermented";
  // The receipts contain abbreviated "LEITE F YAKULT" / "LEITE F ACTIVIA".
  // An isolated F is NOT enough to identify a fermented milk (e.g. Fazenda).
  if (/^leite f\b/.test(n) && /\b(?:yakult|activia|frutap)\b/.test(n)) {
    return "milkFermented";
  }
  if (/^leite (?:em )?po\b/.test(n)) return "milkPowder";
  if (/^leite de coco\b/.test(n)) return "milkCoconut";
  return "milkLiquid";
}

export function isGenericMilkQuery(value: string) {
  return /^leites?$/.test(normalizeSearchText(value).trim());
}

export function isBananaFruitQuery(value: string) {
  return /^bananas?(?: fruta| frutas)?$/.test(normalizeSearchText(value).trim());
}

export function bananaProductKind(value: string): "bananaFresh" | "bananaRelated" | null {
  const n = normalizeSearchText(value).trim();
  if (!/\bbananas?\b/.test(n)) return null;
  const processed = /\b(?:barra|barrinha|chips|chocolate|bombom|biscoito|bolo|doce|passa|desidratada|sorvete|iogurte|vitamina|suco|creme|sabor|aromatizado)\b/.test(n);
  if (/^bananas?\b/.test(n) && !processed) return "bananaFresh";
  return "bananaRelated";
}

export function isFruitBananaProduct(value: string) {
  return bananaProductKind(value) === "bananaFresh";
}
