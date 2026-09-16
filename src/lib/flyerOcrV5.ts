import { normalizeSearchText, type FlyerCandidate } from "@/lib/flyerAnalysis";
import { readFlyerFileSmart as readFlyerV4 } from "@/lib/flyerOcrV4";

// V5 deliberately prefers precision over recall: if a product name looks uncertain,
// we drop it instead of showing/saving a misleading offer.
const PRODUCT_TERMS = new Set([
  "abacate", "abacaxi", "abobora", "acucar", "agua", "alcatra", "amaciante", "arroz", "atum", "aveia", "azeite",
  "banana", "batata", "berinjela", "beterraba", "bife", "biscoito", "bolacha", "bolo", "bombom", "cafe", "carne", "cenoura", "cerveja",
  "chocolate", "cogumelo", "contrafile", "costela", "creme", "detergente", "farinha", "feijao", "file",
  "frango", "goiaba", "iogurte", "kiwi", "lagarto", "laranja", "lasanha", "leite", "limao", "linguica", "lombo", "maca", "macarrao", "mamao", "manga",
  "maracuja", "margarina", "melancia", "melao", "molho", "mortadela", "mussarela", "oleo", "ovos", "pao", "papel", "peito",
  "pera", "pernil", "presunto", "queijo", "repolho", "refrigerante", "sabao", "sabonete", "shampoo", "shimeji", "suco",
  "tomate", "uva", "vinho", "vodka", "whisky", "picanha", "patinho", "acem", "coxao",
  "paleta", "musculo", "tilapia", "sardinha", "salmao", "camarao", "manteiga", "requeijao", "maionese",
  "ketchup", "granola", "cereal", "achocolatado", "sorvete", "pizza", "hamburguer",
  "nuggets", "empanado", "salsicha", "toscana", "bacon", "fralda", "desodorante", "escova", "pasta",
  "absorvente", "toalha", "guardanapo", "esponja", "limpador", "desinfetante", "sanitaria",
]);

const SAFE_SHORT = new Set(["kg", "g", "ml", "l", "lt", "un", "und", "pct", "cx"]);
// "cada" is intentionally not rejected: produce flyers commonly say "preço a cada 100g".
const MARKETING = /\b(oferta|ofertas|clube|vantagens|leve|pague|desconto|economize|validade|valido|validas|apenas)\b/;
const PACKAGE_RE = /\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|lt|un|und|unid|unidades)\b/i;

function alphaWords(value: string) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
}

function malformedWord(token: string) {
  if (SAFE_SHORT.has(token) || /^\d+$/.test(token)) return false;
  if (/\d/.test(token) && /[a-z]/.test(token) && !/^\d+(g|kg|ml|l|lt|un|und)$/.test(token)) return true;
  if (token.length >= 4 && !/[aeiou]/.test(token)) return true;
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(token)) return true;
  if (/(.)\1\1/.test(token) && !/^(coffee|massa)$/.test(token)) return true;
  return false;
}

function readableName(name: string) {
  const normalized = normalizeSearchText(name).replace(/\s+/g, " ").trim();
  if (normalized.length < 5 || normalized.length > 95) return false;
  if (MARKETING.test(normalized)) return false;

  const words = alphaWords(normalized);
  const lexical = words.filter((word) => word.length >= 3 && !SAFE_SHORT.has(word) && !/^\d/.test(word));
  if (!lexical.length) return false;

  const malformed = lexical.filter(malformedWord);
  if (malformed.length > 0) return false;

  const productHits = lexical.filter((word) => PRODUCT_TERMS.has(word)).length;
  const hasPackage = PACKAGE_RE.test(normalized) || /\bkg\b/.test(normalized);
  const vowelWords = lexical.filter((word) => /[aeiou]/.test(word)).length;
  const cleanRatio = vowelWords / Math.max(1, lexical.length);

  // Strong product word: one clear generic noun is enough when the rest is readable.
  if (productHits >= 1 && cleanRatio >= 0.8) return true;

  // Unknown product/brand can still pass, but only if the OCR produced a substantial,
  // package-aware phrase. Short brand fragments are intentionally ignored.
  if (hasPackage && lexical.length >= 3 && cleanRatio === 1) return true;
  if (lexical.length >= 4 && cleanRatio === 1 && normalized.length >= 18) return true;

  return false;
}

function saneOffer(item: FlyerCandidate) {
  if (!readableName(item.rawName)) return false;
  if (!Number.isFinite(item.price) || item.price <= 0 || item.price > 500) return false;
  if (!Number.isFinite(item.normalizedPrice) || item.normalizedPrice <= 0 || item.normalizedPrice > 1200) return false;
  return true;
}

function dedupeStrict(items: FlyerCandidate[]) {
  const seen = new Set<string>();
  const result: FlyerCandidate[] = [];
  for (const item of items) {
    if (!saneOffer(item)) continue;
    const name = normalizeSearchText(item.rawName).replace(/\s+/g, " ").trim();
    const key = `${name}|${item.price.toFixed(2)}|${item.sourcePage ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export async function readFlyerFileSmart(
  file: File,
  onProgress: (page: number, total: number, label: string) => void,
) {
  const result = await readFlyerV4(file, onProgress);
  const candidates = dedupeStrict(result.candidates);
  return {
    ...result,
    candidates,
    textByPage: result.textByPage.map((text, pageIndex) => {
      const pageItems = candidates.filter((item) => (item.sourcePage ?? 1) === pageIndex + 1);
      return pageItems.length
        ? pageItems.map((item) => `${item.rawName} ${item.price.toFixed(2)}`).join("\n")
        : text;
    }),
  };
}
