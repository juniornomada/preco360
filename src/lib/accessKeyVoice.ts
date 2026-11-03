const SINGLE_DIGITS: Record<string, string> = {
  zero: "0",
  um: "1",
  uma: "1",
  dois: "2",
  duas: "2",
  tres: "3",
  quatro: "4",
  cinco: "5",
  seis: "6",
  meia: "6",
  sete: "7",
  oito: "8",
  nove: "9",
};

const SMALL_NUMBERS: Record<string, number> = {
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezasseis: 16,
  dezessete: 17,
  dezassete: 17,
  dezoito: 18,
  dezenove: 19,
  dezanove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
};

// Explicit counted zeros prevent the browser from silently dropping
// repeated identical words. "Quatro zero" without a plural still means 40.
const ZERO_COUNT_WORDS: Record<string, number> = {
  um: 1, uma: 1,
  dois: 2, duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6, meia: 6,
  sete: 7,
  oito: 8,
  nove: 9,
};

function zeroCountForToken(token: string): number | null {
  if (/^[1-9]$/.test(token)) return Number(token);
  return ZERO_COUNT_WORDS[token] ?? null;
}

function normalizeToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Converts a pt-BR speech transcript into access-key digits.
 *
 * The recognizer may return:
 * - literal digits: "3 5 2 6"
 * - digit words: "três cinco dois seis"
 * - grouped cardinals: "trinta e cinco vinte e seis"
 *
 * Grouped cardinals are intentionally limited to 10..99. Longer numeric
 * sequences are normally returned as literal digits by the browser ASR.
 */
export function accessKeyDigitsFromTranscript(value: string) {
  const rawTokens = value
    .replace(/([0-9])([A-Za-zÀ-ÿ])/g, "$1 $2")
    .replace(/([A-Za-zÀ-ÿ])([0-9])/g, "$1 $2")
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);

  let out = "";

  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];

    // Explicit count + plural is distinct from ordinary digit dictation.
    // Also accept "quatro vezes zero" and "zero quatro vezes".
    const count = zeroCountForToken(token);
    if (count !== null && rawTokens[index + 1] === "zeros") {
      out += "0".repeat(count);
      index += 1;
      continue;
    }
    if (
      count !== null &&
      rawTokens[index + 1] === "vezes" &&
      rawTokens[index + 2] === "zero"
    ) {
      out += "0".repeat(count);
      index += 2;
      continue;
    }
    if (token === "zero" && rawTokens[index + 2] === "vezes") {
      const followingCount = zeroCountForToken(rawTokens[index + 1] ?? "");
      if (followingCount !== null) {
        out += "0".repeat(followingCount);
        index += 2;
        continue;
      }
    }

    if (/^\d+$/.test(token)) {
      out += token;
      continue;
    }

    const single = SINGLE_DIGITS[token];
    if (single !== undefined) {
      out += single;
      continue;
    }

    const small = SMALL_NUMBERS[token];
    if (small === undefined) continue;

    if (small >= 20 && small % 10 === 0) {
      const maybeAnd = rawTokens[index + 1] === "e" ? 1 : 0;
      const next = rawTokens[index + 1 + maybeAnd];
      const unit = next ? SINGLE_DIGITS[next] : undefined;

      if (unit !== undefined && unit !== "0") {
        out += String(small + Number(unit));
        index += 1 + maybeAnd;
        continue;
      }
    }

    out += String(small);
  }

  return out;
}

export function sanitizeAccessKeyDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 44);
}

/**
 * Explicit manual fallback when native speech recognition collapses
 * "quatro zeros" into the ambiguous number 40. Never reinterpret a spoken
 * "40" automatically, because it might genuinely mean digits 4 and 0.
 */
export function appendAccessKeyZeroRun(
  value: string,
  count: 1 | 2 | 3 | 4,
) {
  const clean = sanitizeAccessKeyDigits(value);
  if (clean.length + count > 44) return clean;
  return clean + "0".repeat(count);
}
