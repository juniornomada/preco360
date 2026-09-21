import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Item = {
  name: string;
  price: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  totalPrice?: string;
};
type Diagnostics = {
  htmlLength?: number;
  lineCount?: number;
  renderedItems?: number;
  rowItems?: number;
  titleItems?: number;
  selectedStrategy?: string;
  marker?: string | null;
  finalHost?: string;
  finalPath?: string;
};

class ImportError extends Error {
  constructor(message: string, public code: string, public finalUrl?: string) {
    super(message);
  }
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

function decodeEntities(value: string) {
  return value
    .replace(/&#(x?[0-9a-f]+);/gi, (_m, raw) =>
      String.fromCodePoint(raw.toLowerCase().startsWith("x") ? parseInt(raw.slice(1), 16) : parseInt(raw, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeMarkup(raw: string) {
  let value = raw;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(value)
      .replace(/\\u([0-9a-f]{4})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
    if (next === value) break;
    value = next;
  }
  return value;
}

function strip(html: string) {
  return decodeEntities(
    html
      .replace(/<(style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:tr|td|th|div|p|li|section|h[1-6]|span|strong)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

const linesOf = (markup: string) =>
  strip(markup)
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

function money(raw?: string | null) {
  if (!raw) return null;
  let s = raw.replace(/R\$/gi, "").replace(/\s/g, "");
  if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

function normalizeName(name: string) {
  return name.replace(/\s+/g, " ").replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
}

function isBadName(name: string) {
  const clean = normalizeName(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.:;,_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return true;
  if (/^(un|und|unid|kg|g|mg|l|lt|ml|cx|pct|pc)$/.test(clean)) return true;
  if (/^(total|subtotal|troco|desconto|valor|qtd|qtde|quantidade|pagamento|tributos?|icms|pis|cofins|chave|protocolo|consumidor|cpf|cnpj|data|emissao|codigo|descricao)$/.test(clean)) return true;
  if (/^(vl|v|valor)\s*(unit|unitario|total)$/.test(clean)) return true;
  if (/^(qtd|qtde|quantidade)\b/.test(clean)) return true;
  if (/^(valor\s+(pago|a\s+pagar|recebido|total)|total\s+(pago|a\s+pagar)|forma\s+de\s+pagamento|cartao\b|dinheiro\b|pix\b)/.test(clean)) return true;
  return false;
}

function dedupe(items: Item[]) {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const raw of items) {
    const name = normalizeName(raw.name);
    const price = money(raw.price);
    if (!name || name.length < 2 || isBadName(name) || !price) continue;
    const key = `${name.toLowerCase()}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...raw, name, price });
  }
  return out.slice(0, 300);
}

function unitPriceFromText(text: string) {
  const labeled = text.match(
    /(?:Vl\.?\s*Unit\.?|Valor\s*Unit(?:ário)?|V\.\s*Unit)\s*:?\s*(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})/i,
  )?.[1];
  if (labeled) return money(labeled);

  const multiplied = text.match(
    /\b\d{1,6}(?:[.,]\d{1,4})?\s*(?:KG|G|UN|UND|UNID|L|LT|ML|CX|PCT|PC)\s*(?:X|×)\s*(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})/i,
  )?.[1];
  return money(multiplied);
}

function totalPriceFromText(text: string) {
  return money(
    text.match(/(?:Vl\.?\s*Total|Valor\s*Total|V\.\s*Total)\s*:?\s*(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})/i)?.[1],
  );
}

function numberValue(raw?: string | null) {
  if (!raw) return null;
  const normalized = raw.trim().replace(/\./g, "").replace(",", ".");
  const value = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeUnit(raw?: string | null) {
  const unit = String(raw ?? "").trim().toUpperCase();
  if (!unit) return undefined;
  if (unit === "UND" || unit === "UNID") return "UN";
  if (unit === "LT") return "L";
  return unit;
}

function itemDetailsFromText(text: string) {
  const multiplied = text.match(
    /\b(\d{1,6}(?:[.,]\d{1,4})?)\s*(KG|G|UN|UND|UNID|L|LT|ML|CX|PCT|PC)\s*(?:X|×)\s*(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})/i,
  );

  const quantityRaw =
    text.match(/(?:Qtde\.?|Qtd\.?|Quantidade)\s*:?\s*(\d{1,6}(?:[.,]\d{1,4})?)/i)?.[1] ??
    multiplied?.[1] ??
    null;
  const unitRaw =
    text.match(/(?:\bUN\b|Unidade|Un\.)\s*:?\s*(KG|G|UN|UND|UNID|L|LT|ML|CX|PCT|PC)\b/i)?.[1] ??
    multiplied?.[2] ??
    null;

  const quantity = numberValue(quantityRaw);
  const unit = normalizeUnit(unitRaw);
  const labeledUnitPrice = unitPriceFromText(text);
  const totalPrice = totalPriceFromText(text);

  let unitPrice = labeledUnitPrice;
  if (!unitPrice && totalPrice && quantity) {
    const derived = Number(totalPrice) / quantity;
    if (Number.isFinite(derived) && derived > 0) unitPrice = derived.toFixed(2);
  }

  const finalTotal =
    totalPrice ??
    (unitPrice && quantity
      ? (Number(unitPrice) * quantity).toFixed(2)
      : null);

  return {
    quantity: quantity ? String(quantity) : undefined,
    unit,
    unitPrice: unitPrice ?? undefined,
    totalPrice: finalTotal ?? undefined,
    price: unitPrice ?? finalTotal ?? null,
  };
}

// Parser principal para o layout exibido pela SEFAZ/SP: produto em uma linha,
// (Código: ...) logo abaixo, seguido de Qtde., UN, Vl. Unit. e Vl. Total.
function parseRenderedItems(lines: string[]): Item[] {
  const items: Item[] = [];

  for (let i = 0; i < lines.length; i++) {
    const codeMatch = lines[i].match(/^(.*?)\(\s*C[oó]digo\s*:\s*[^)]+\)/i);
    if (!codeMatch) continue;

    let name = normalizeName(codeMatch[1] || "");
    if (!name) {
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const candidate = normalizeName(lines[j]);
        if (!candidate || isBadName(candidate)) continue;
        if (/^(qtde|qtd|un|vl\.?\s*unit|vl\.?\s*total)/i.test(candidate)) continue;
        name = candidate;
        break;
      }
    }

    if (!name || isBadName(name)) continue;

    let end = Math.min(lines.length, i + 16);
    for (let j = i + 1; j < end; j++) {
      if (/\(\s*C[oó]digo\s*:/i.test(lines[j])) {
        end = j;
        break;
      }
    }

    const block = lines.slice(i, end).join(" ");
    const details = itemDetailsFromText(block);
    if (details.price) items.push({ name, ...details, price: details.price });
  }

  return dedupe(items);
}

function spanByClass(html: string, className: string) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<span\\b[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`,
    "i",
  );
  return html.match(re)?.[1] ?? null;
}

function parseNfceRows(markup: string): Item[] {
  const items: Item[] = [];
  for (const rowMatch of markup.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1];
    const titleHtml = spanByClass(row, "txtTit");
    if (!titleHtml) continue;

    const name = normalizeName(strip(titleHtml));
    if (!name || isBadName(name) || /^vl\.?\s*total$/i.test(name)) continue;

    const rowText = strip(row).replace(/\s+/g, " ");
    const unitHtml = spanByClass(row, "RvlUnit");
    const details = itemDetailsFromText(rowText);
    const htmlUnitPrice = money(unitHtml ? strip(unitHtml) : null);
    const unitPrice = details.unitPrice ?? htmlUnitPrice ?? undefined;
    const price = unitPrice ?? details.totalPrice ?? null;

    if (price) {
      items.push({
        name,
        ...details,
        unitPrice,
        price,
      });
    }
  }
  return dedupe(items);
}

function parseTitleBlocks(markup: string): Item[] {
  const re = /<[^>]+class=["'][^"']*txtTit[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
  const hits: Array<{ name: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(markup))) {
    const name = normalizeName(strip(match[1]));
    if (name && !isBadName(name)) hits.push({ name, start: match.index, end: re.lastIndex });
  }

  const items: Item[] = [];
  hits.forEach((hit, index) => {
    const end = hits[index + 1]?.start ?? Math.min(markup.length, hit.end + 5000);
    const block = strip(markup.slice(hit.end, end)).replace(/\s+/g, " ");
    const details = itemDetailsFromText(block);
    if (details.price) items.push({ name: hit.name, ...details, price: details.price });
  });

  return dedupe(items);
}

function supermarket(lines: string[]) {
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    if (!/\bCNPJ\b/i.test(lines[i])) continue;
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const candidate = lines[j];
      if (candidate && /[A-Za-zÀ-ÿ]/.test(candidate) && candidate.length >= 3 && !/documento auxiliar|nota fiscal/i.test(candidate)) {
        return candidate;
      }
    }
  }
  return lines.find((line) => /supermerc|mercado|atacad|comercial|hiper|varej|confian/i.test(line)) ?? "";
}

function receiptDate(text: string) {
  const br = text.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : undefined;
}

function markerCode(html: string) {
  const lower = html.toLowerCase();
  if (/g-recaptcha|recaptcha\/api\.js|hcaptcha|captcha|digite os caracteres da imagem/.test(lower)) return "CAPTCHA_REQUIRED";
  if (/nfc-e não encontrada|nfe não encontrada|documento não localizado/.test(lower)) return "NOT_FOUND";
  if (/formato de qr-code não suportado|qr-?code inválido/.test(lower)) return "QR_FORMAT";
  return null;
}

async function fetchFiscal(raw: string) {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol) || !(url.hostname === "gov.br" || url.hostname.endsWith(".gov.br"))) {
    throw new ImportError("Endereço fiscal inválido.", "INVALID_URL");
  }

  const response = await fetch(url.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
  });

  const finalUrl = response.url || url.toString();
  if (response.status === 403 || response.status === 429) {
    throw new ImportError("A SEFAZ bloqueou a consulta automática.", "BLOCKED", finalUrl);
  }
  if (!response.ok) throw new ImportError(`SEFAZ respondeu HTTP ${response.status}.`, "HTTP_ERROR", finalUrl);

  return { html: await response.text(), finalUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const traceId = crypto.randomUUID().slice(0, 8);
  let diagnostics: Diagnostics = {};

  try {
    const body = await req.json();
    let raw = "";
    let finalUrl: string | undefined;

    if (typeof body?.pageText === "string" && body.pageText.trim()) {
      raw = body.pageText.trim();
    } else if (typeof body?.url === "string" && body.url.trim()) {
      const loaded = await fetchFiscal(body.url.trim());
      raw = loaded.html;
      finalUrl = loaded.finalUrl;
    } else {
      throw new ImportError("Informe a URL do QR Code ou o conteúdo da consulta.", "MISSING_URL");
    }

    const markup = normalizeMarkup(raw);
    const lines = linesOf(markup);
    const marker = markerCode(markup);

    const renderedItems = parseRenderedItems(lines);
    const rowItems = parseNfceRows(markup);
    const titleItems = parseTitleBlocks(markup);

    let selectedStrategy = "none";
    let items: Item[] = [];

    if (renderedItems.length) {
      selectedStrategy = "sefaz-rendered-blocks";
      items = renderedItems;
    } else if (rowItems.length) {
      selectedStrategy = "nfce-rows";
      items = rowItems;
    } else if (titleItems.length) {
      selectedStrategy = "title-blocks";
      items = titleItems;
    }

    if (finalUrl) {
      try {
        const parsed = new URL(finalUrl);
        diagnostics.finalHost = parsed.host;
        diagnostics.finalPath = parsed.pathname;
      } catch {
        // ignore
      }
    }

    diagnostics = {
      ...diagnostics,
      htmlLength: raw.length,
      lineCount: lines.length,
      renderedItems: renderedItems.length,
      rowItems: rowItems.length,
      titleItems: titleItems.length,
      selectedStrategy,
      marker,
    };

    if (!items.length) {
      if (marker === "CAPTCHA_REQUIRED") throw new ImportError("A SEFAZ exige CAPTCHA nessa consulta.", marker, finalUrl);
      if (marker === "NOT_FOUND") throw new ImportError("Cupom não encontrado pela SEFAZ.", marker, finalUrl);
      if (marker === "QR_FORMAT") throw new ImportError("A SEFAZ rejeitou o formato do QR Code.", marker, finalUrl);
      throw new ImportError("A página abriu, mas ainda não consegui identificar os produtos desse layout da SEFAZ.", "NO_ITEMS", finalUrl);
    }

    return reply({
      supermarket: supermarket(lines),
      date: receiptDate(lines.join(" ")),
      items,
      traceId,
      sourceUrl: finalUrl,
      diagnostics,
    });
  } catch (e) {
    const err = e instanceof ImportError ? e : new ImportError(e instanceof Error ? e.message : "Falha inesperada.", "UNKNOWN");
    const expected = ["CAPTCHA_REQUIRED", "BLOCKED", "NO_ITEMS", "QR_FORMAT", "NOT_FOUND"].includes(err.code);
    return reply(
      {
        error: err.message,
        code: err.code,
        blocked: expected,
        suggestPhoto: expected,
        finalUrl: err.finalUrl,
        traceId,
        diagnostics,
      },
      expected ? 200 : 500,
    );
  }
});