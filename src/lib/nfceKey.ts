/** Validação da chave de acesso da NFC-e (44 dígitos) */

export const UF_NAMES: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

export interface KeyValidation {
  clean: string;
  valid: boolean;
  /** Mensagem de erro pronta para exibir (vazia quando válida) */
  error?: string;
  /** Aviso não bloqueante */
  warning?: string;
  uf?: string;
  /** Mês/ano de emissão (AAMM) formatado */
  emitted?: string;
  model?: string;
}

/** Dígito verificador módulo 11 dos 43 primeiros dígitos */
export function checkDigit(first43: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest === 0 || rest === 1 ? 0 : 11 - rest;
}

export function validateAccessKey(raw: string): KeyValidation {
  const trimmed = raw.trim();
  const clean = trimmed.replace(/[\s.-]/g, "");

  if (!clean) return { clean, valid: false };

  if (/\D/.test(clean)) {
    return { clean, valid: false, error: "A chave deve conter apenas números (espaços e pontos são ignorados)." };
  }

  if (clean.length < 44) {
    return { clean, valid: false, error: `Faltam ${44 - clean.length} dígito(s) — a chave tem 44 números.` };
  }
  if (clean.length > 44) {
    return { clean, valid: false, error: `Há ${clean.length - 44} dígito(s) a mais — a chave tem exatamente 44 números.` };
  }

  const uf = clean.substring(0, 2);
  if (!UF_NAMES[uf]) {
    return { clean, valid: false, error: `Os 2 primeiros dígitos (${uf}) não correspondem a um estado válido. Confira o início da chave.` };
  }

  const yy = clean.substring(2, 4);
  const mm = clean.substring(4, 6);
  const month = Number(mm);
  if (month < 1 || month > 12) {
    return { clean, valid: false, error: `O mês de emissão na chave (${mm}) é inválido. Confira os dígitos 5 e 6.` };
  }

  const model = clean.substring(20, 22);
  if (checkDigit(clean.substring(0, 43)) !== Number(clean[43])) {
    return {
      clean,
      valid: false,
      error: "Dígito verificador inválido: algum número foi digitado errado. Confira a chave impressa no cupom.",
    };
  }

  return {
    clean,
    valid: true,
    uf: UF_NAMES[uf],
    emitted: `${mm}/20${yy}`,
    model,
    warning:
      model !== "65"
        ? "Essa chave parece ser de NF-e (modelo 55), não de cupom NFC-e (modelo 65). A consulta pode não retornar produtos."
        : undefined,
  };
}

/** Parâmetros de query usados pelos portais para carregar a chave */
const KEY_PARAMS = ["chNFe", "chnfe", "chave", "chaveAcesso", "chaveacesso", "nfe", "p", "q", "key"];

/** Retorna todos os candidatos a chave (44 dígitos) presentes num texto */
function keyCandidates(text: string): string[] {
  const normalized = text.replace(/[\s.\-]/g, "");
  return normalized.match(/\d{44}/g) ?? [];
}

/**
 * Extrai a chave de acesso (44 dígitos) de qualquer variação de URL de consulta
 * (?chNFe=, ?p=CHAVE|2|1|1|hash, ?chave=, #fragmento, chave dentro do caminho)
 * ou de um texto colado com a chave solta.
 */
export function extractAccessKey(input: string): string | null {
  const text = (input ?? "").trim();
  if (!text) return null;

  const pickValid = (list: string[]): string | null => {
    const valid = list.find((k) => validateAccessKey(k).valid);
    return valid ?? list[0] ?? null;
  };

  const urlText = text.match(/https?:\/\/\S+/i)?.[0] ?? (text.includes("?") || text.includes("=") ? text : null);
  if (urlText) {
    try {
      const u = new URL(urlText.startsWith("http") ? urlText : `https://x/${urlText}`);
      const sources: string[] = [];
      const collect = (params: URLSearchParams) => {
        for (const name of KEY_PARAMS) {
          const v = params.get(name);
          if (v) sources.push(decodeURIComponent(v));
        }
      };
      collect(u.searchParams);
      // alguns portais colocam a query dentro do fragmento (#/consulta?p=...)
      const hash = u.hash.replace(/^#\/?/, "");
      if (hash.includes("=")) collect(new URLSearchParams(hash.split("?").pop() ?? hash));

      for (const source of sources) {
        const found = pickValid(keyCandidates(source));
        if (found) return found;
      }
      // fallback: chave em qualquer parte da URL (caminho, outros parâmetros)
      const anywhere = pickValid(keyCandidates(decodeURIComponent(u.href)));
      if (anywhere) return anywhere;
    } catch {
      /* não é URL válida — cai para busca livre */
    }
  }

  return pickValid(keyCandidates(text));
}

export interface NfceUrlValidation {
  valid: boolean;
  /** URL normalizada com o parâmetro chNFe */
  url?: string;
  key?: string;
  error?: string;
}

/**
 * Valida um link de consulta de NFC-e: precisa ser http(s), de um portal da SEFAZ
 * e conter a chave de acesso — que é normalizada para o parâmetro `chNFe`.
 */
export function validateNfceUrl(input: string): NfceUrlValidation {
  const text = (input ?? "").trim();
  if (!text) return { valid: false, error: "Cole a URL do QR Code do cupom fiscal." };

  const candidate = text.match(/https?:\/\/\S+/i)?.[0] ?? null;
  if (!candidate) {
    return {
      valid: false,
      error: /^\d[\d\s.-]*$/.test(text)
        ? "Isso parece uma chave de acesso, não uma URL. Use a aba \"Chave de Acesso\" ou cole o link completo do QR Code."
        : "Não reconheci uma URL. O link do QR Code começa com http:// ou https://.",
    };
  }

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { valid: false, error: "A URL informada está mal formatada. Copie o endereço completo do QR Code." };
  }

  if (!/^https?:$/.test(u.protocol)) {
    return { valid: false, error: "A URL precisa começar com http:// ou https://." };
  }

  if (!/(fazenda|sefaz|nfce|nfe|dfe)\./i.test(u.hostname) && !/(fazenda|sefaz|nfce|nfe|dfe)/i.test(u.hostname)) {
    return {
      valid: false,
      error: `O endereço "${u.hostname}" não é um portal de NFC-e da SEFAZ. Use o link que está no QR Code do cupom.`,
    };
  }

  const key = extractAccessKey(u.href);
  if (!key) {
    return {
      valid: false,
      error: "Não encontrei a chave de acesso (44 dígitos) nessa URL. Confira se copiou o link inteiro do QR Code, incluindo os parâmetros.",
    };
  }

  const check = validateAccessKey(key);
  if (!check.valid) {
    return { valid: false, key, error: `A chave contida na URL é inválida. ${check.error ?? ""}`.trim() };
  }

  // garante o parâmetro chNFe preservando os demais (ex.: `p` com o hash do QR Code)
  const normalized = new URL(u.href);
  if (!normalized.searchParams.get("chNFe")) {
    normalized.searchParams.set("chNFe", key);
  }

  return { valid: true, url: normalized.toString(), key };
}
