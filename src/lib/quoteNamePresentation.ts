/**
 * Display-only OCR/fiscal abbreviations used on the Cotar screen.
 * These do not change product IDs, saved names, history, or matching rules.
 */
export function readableQuoteProductName(value: string): string {
  return value.trim()
    .replace(/^massa\s+p\s*\/\s*pastel\b/i, "Massa para pastel")
    .replace(/^massa\s+pastel\b/i, "Massa para pastel")
    .replace(/^pao\s+qjo\b/i, "Pão de queijo")
    .replace(/\bsao\s+judas\b/gi, "São Judas")
    .replace(/\bmassalev\b/gi, "Massaleve");
}
