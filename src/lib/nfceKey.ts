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
  error?: string;
  warning?: string;
  uf?: string;
  emitted?: string;
  model?: string;
}

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
  if (/\D/.test(clean)) return { clean, valid: false, error: "A chave deve conter apenas números (espaços e pontos são ignorados)." };
  if (clean.length < 44) return { clean, valid: false, error: `Faltam ${44 - clean.length} dígito(s) — a chave tem 44 números.` };
  if (clean.length > 44) return { clean, valid: false, error: `Há ${clean.length - 44} dígito(s) a mais — a chave tem exatamente 44 números.` };

  const uf = clean.substring(0, 2);
  if (!UF_NAMES[uf]) return { clean, valid: false, error: `Os 2 primeiros dígitos (${uf}) não correspondem a um estado válido. Confira o início da chave.` };

  const yy = clean.substring(2, 4);
  const mm = clean.substring(4, 6);
  const month = Number(mm);
  if (month < 1 || month > 12) return { clean, valid: false, error: `O mês de emissão na chave (${mm}) é inválido. Confira os dígitos 5 e 6.` };

  const model = clean.substring(20, 22);
  if (checkDigit(clean.substring(0, 43)) !== Number(clean[43])) {
    return { clean, valid: false, error: "Dígito verificador inválido: algum número foi digitado errado. Confira a chave impressa no cupom." };
  }

  return {
    clean,
    valid: true,
    uf: UF_NAMES[uf],
    emitted: `${mm}/20${yy}`,
    model,
    warning:
      model === "55" || model === "65"
        ? undefined
        : `Modelo fiscal ${model} ainda não é suportado por esse fluxo assistido.`,
  };
}

const KEY_PARAMS = ["chNFe", "chnfe", "chave", "chaveAcesso", "chaveacesso", "nfe", "p", "q", "key"];

function keyCandidates(text: string): string[] {
  const normalized = text.replace(/[\s.\-]/g, "");
  return normalized.match(/\d{44}/g) ?? [];
}

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
      const hash = u.hash.replace(/^#\/?/, "");
      if (hash.includes("=")) collect(new URLSearchParams(hash.split("?").pop() ?? hash));

      for (const source of sources) {
        const found = pickValid(keyCandidates(source));
        if (found) return found;
      }
      const anywhere = pickValid(keyCandidates(decodeURIComponent(u.href)));
      if (anywhere) return anywhere;
    } catch {
      // cai para a busca livre
    }
  }

  return pickValid(keyCandidates(text));
}

export interface NfceUrlValidation {
  valid: boolean;
  url?: string;
  key?: string;
  error?: string;
}

/**
 * Valida a URL do QR Code sem reescrevê-la.
 * Os parâmetros originais do QR precisam ser preservados exatamente porque fazem
 * parte da consulta e, em alguns layouts, da própria validação do QR Code.
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

  if (!/^https?:$/.test(u.protocol)) return { valid: false, error: "A URL precisa começar com http:// ou https://." };
  if (!/(fazenda|sefaz|nfce|nfe|dfe)/i.test(u.hostname) && !u.hostname.endsWith(".gov.br")) {
    return { valid: false, error: `O endereço "${u.hostname}" não parece ser um portal fiscal oficial. Use o link que está no QR Code do cupom.` };
  }

  const key = extractAccessKey(candidate);
  if (!key) {
    return { valid: false, error: "Não encontrei a chave de acesso (44 dígitos) nessa URL. Confira se copiou o link inteiro do QR Code, incluindo os parâmetros." };
  }

  const check = validateAccessKey(key);
  if (!check.valid) return { valid: false, key, error: `A chave contida na URL é inválida. ${check.error ?? ""}`.trim() };

  return { valid: true, url: candidate, key };
}


export type FiscalDocumentKind = "nfe" | "nfce" | "unknown";

const NFCE_UF_URLS: Record<string, string> = {
  "35": "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx",
  "33": "https://www.nfce.fazenda.rj.gov.br/consulta",
  "31": "https://nfce.fazenda.mg.gov.br/portalnfce/sistema/consultaarg.xhtml",
  "41": "https://www.nfce.pr.gov.br/nfce/qrcode",
  "43": "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
  "29": "https://nfe.sefaz.ba.gov.br/servicos/nfce/modulos/geral/NFCEC_consulta_chave_acesso.aspx",
  "26": "https://nfce.sefaz.pe.gov.br/nfce/consulta",
  "23": "https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html",
  "52": "https://nfe.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
  "50": "https://www.dfe.ms.gov.br/nfce/qrcode",
  "53": "https://dec.fazenda.df.gov.br/NFCE/qrcode",
};

export function fiscalDocumentKind(raw: string): FiscalDocumentKind {
  const check = validateAccessKey(raw);
  if (!check.valid) return "unknown";
  if (check.model === "55") return "nfe";
  if (check.model === "65") return "nfce";
  return "unknown";
}

export function fiscalDocumentLabel(raw: string) {
  const check = validateAccessKey(raw);
  if (!check.valid) return "Documento fiscal";
  if (check.model === "55") return "NF-e modelo 55";
  if (check.model === "65") return "NFC-e modelo 65";
  return `Documento modelo ${check.model ?? "desconhecido"}`;
}

export function buildOfficialConsultationUrl(raw: string) {
  const check = validateAccessKey(raw);
  if (!check.valid) return null;

  if (check.model === "55") {
    const ufCode = check.clean.slice(0, 2);

    // Para SP, prioriza a SEFAZ que autorizou o documento. Ela aceita
    // `chaveAcesso` na URL e já abre a consulta pública com os 44 dígitos
    // preenchidos; o usuário resolve apenas o CAPTCHA.
    if (ufCode === "35") {
      const url = new URL(
        "https://www.nfe.fazenda.sp.gov.br/ConsultaNFe/consulta/publica/ConsultarNFe.aspx",
      );
      url.searchParams.set("chaveAcesso", check.clean);
      return url.toString();
    }

    // Fallback oficial enquanto não houver uma rota estadual validada para a UF.
    const url = new URL(
      "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx",
    );
    url.searchParams.set("tipoConsulta", "completa");
    url.searchParams.set("tipoConteudo", "7PhJ+gAVw2g=");
    url.searchParams.set("nfe", check.clean);
    return url.toString();
  }

  if (check.model === "65") {
    const ufCode = check.clean.slice(0, 2);
    const base =
      NFCE_UF_URLS[ufCode] ??
      "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx";
    const url = new URL(base);

    if (url.hostname.includes("nfe.fazenda.gov.br")) {
      url.searchParams.set("tipoConsulta", "completa");
      url.searchParams.set("tipoConteudo", "7PhJ+gAVw2g=");
      url.searchParams.set("nfe", check.clean);
    } else {
      url.searchParams.set("chNFe", check.clean);
    }
    return url.toString();
  }

  return null;
}
