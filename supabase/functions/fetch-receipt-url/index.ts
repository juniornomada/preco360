import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Item = { name: string; price: string };

class ImportError extends Error {
  constructor(message: string, public code: string, public finalUrl?: string) {
    super(message);
  }
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
});

const decode = (s: string) => s
  .replace(/&#(x?[0-9a-f]+);/gi, (_, raw) => String.fromCodePoint(raw.toLowerCase().startsWith("x") ? parseInt(raw.slice(1), 16) : parseInt(raw, 10)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'");

const strip = (html: string) => decode(
  html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:tr|td|th|div|p|li|section|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " "),
).replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();

const linesOf = (html: string) => strip(html)
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

const badName = /^(total|subtotal|troco|desconto|valor|qtd|qtde|quantidade|pagamento|tribut|icms|pis|cofins|chave|protocolo|consumidor|cpf|cnpj|data|emiss[aã]o|c[oó]digo|descri[cç][aã]o|vl\.?\s*unit|vl\.?\s*total)$/i;

function normalizeName(name: string) {
  return name.replace(/\s+/g, " ").replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
}

function dedupe(items: Item[]) {
  const seen = new Set<string>();
  const output: Item[] = [];
  for (const raw of items) {
    const name = normalizeName(raw.name);
    const price = money(raw.price);
    if (!name || name.length < 2 || badName.test(name) || !price) continue;
    const key = `${name.toLowerCase()}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ name, price });
  }
  return output.slice(0, 300);
}

function monetaryValues(text: string) {
  const values = [...text.matchAll(/(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})/g)]
    .map((m) => money(m[1]))
    .filter((v): v is string => Boolean(v));
  return values;
}

function parseTitleBlocks(html: string): Item[] {
  const re = /<[^>]+class=["'][^"']*txtTit[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
  const hits: Array<{ name: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = normalizeName(strip(m[1]));
    if (name) hits.push({ name, start: m.index, end: re.lastIndex });
  }

  const items: Item[] = [];
  hits.forEach((hit, i) => {
    const end = hits[i + 1]?.start ?? Math.min(html.length, hit.end + 4500);
    const chunk = html.slice(hit.end, end);
    const text = strip(chunk);

    const preferred = [
      /(?:Vl\.?\s*Total|Valor\s*Total|V\.\s*Total)\s*:?\s*(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})/i,
      /class=["'][^"']*(?:valor|vlTotal|valorTotal|vProd)[^"']*["'][^>]*>[\s\S]*?(\d{1,7}(?:\.\d{3})*[.,]\d{2})/i,
    ];

    let price: string | null = null;
    for (const pattern of preferred) {
      const found = (chunk.match(pattern) ?? text.match(pattern))?.[1];
      price = money(found);
      if (price) break;
    }
    if (!price) {
      const values = monetaryValues(text);
      price = values.at(-1) ?? null;
    }
    if (price) items.push({ name: hit.name, price });
  });
  return items;
}

function parseTableRows(html: string): Item[] {
  const items: Item[] = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1];
    const cells = [...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
      .map((m) => normalizeName(strip(m[1])))
      .filter(Boolean);
    if (cells.length < 2) continue;

    const allText = cells.join(" | ");
    const prices = monetaryValues(allText);
    if (!prices.length) continue;

    const candidates = cells.filter((cell) => /[A-Za-zÀ-ÿ]/.test(cell) && !badName.test(cell) && !/^(UN|KG|LT|L|CX|PCT|PC|UND?)$/i.test(cell));
    const name = candidates.sort((a, b) => b.length - a.length)[0];
    if (!name || name.length > 180) continue;
    items.push({ name, price: prices.at(-1)! });
  }
  return items;
}

function parseLines(lines: string[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 3 || badName.test(line)) continue;

    const sameLine = line.match(/^(.{3,150}?)\s+(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})$/);
    if (sameLine && /[A-Za-zÀ-ÿ]/.test(sameLine[1])) {
      const price = money(sameLine[2]);
      if (price) items.push({ name: sameLine[1], price });
      continue;
    }

    if (!/[A-Za-zÀ-ÿ]/.test(line) || monetaryValues(line).length) continue;
    for (let j = 1; j <= 5 && i + j < lines.length; j++) {
      const next = lines[i + j];
      const marked = next.match(/(?:Vl\.?\s*Total|Valor\s*Total|V\.\s*Total)\s*:?\s*(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})/i)?.[1];
      const standalone = next.match(/^(?:R\$\s*)?(\d{1,7}(?:\.\d{3})*[.,]\d{2})$/)?.[1];
      const price = money(marked ?? standalone);
      if (price) {
        items.push({ name: line, price });
        break;
      }
    }
  }
  return items;
}

function supermarket(lines: string[]) {
  for (let i = 0; i < Math.min(35, lines.length); i++) {
    if (/\bCNPJ\b/i.test(lines[i])) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const candidate = lines[j];
        if (candidate && /[A-Za-zÀ-ÿ]/.test(candidate) && candidate.length >= 3 && !/documento auxiliar|nota fiscal/i.test(candidate)) return candidate;
      }
    }
  }
  return lines.find((line) => /supermerc|mercado|atacad|comercial|hiper|varej/i.test(line)) ?? "";
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
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol) || (!u.hostname.endsWith(".gov.br") && !/(sefaz|fazenda|nfce|nfe|dfe)/i.test(u.hostname))) {
    throw new ImportError("Endereço fiscal inválido.", "INVALID_URL");
  }

  const response = await fetch(u.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
  });

  const finalUrl = response.url || u.toString();
  if (response.status === 403 || response.status === 429) {
    throw new ImportError("A SEFAZ bloqueou a consulta automática. Use a validação assistida.", "BLOCKED", finalUrl);
  }
  if (!response.ok) throw new ImportError(`SEFAZ respondeu HTTP ${response.status}.`, "HTTP_ERROR", finalUrl);

  return { html: await response.text(), finalUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const traceId = crypto.randomUUID().slice(0, 8);

  try {
    const body = await req.json();
    let html = "";
    let finalUrl: string | undefined;
    let lines: string[] = [];

    if (typeof body?.pageText === "string" && body.pageText.trim()) {
      const raw = body.pageText.trim();
      html = /<[a-z][\s\S]*>/i.test(raw) ? raw : "";
      lines = html ? linesOf(html) : raw.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
    } else if (typeof body?.url === "string" && body.url.trim()) {
      const loaded = await fetchFiscal(body.url.trim());
      html = loaded.html;
      finalUrl = loaded.finalUrl;
      lines = linesOf(html);
    } else {
      throw new ImportError("Informe a URL do QR Code ou o conteúdo da consulta.", "MISSING_URL");
    }

    const titleItems = html ? parseTitleBlocks(html) : [];
    const tableItems = html ? parseTableRows(html) : [];
    const lineItems = parseLines(lines);
    const items = dedupe([...titleItems, ...tableItems, ...lineItems]);

    if (!items.length) {
      const marker = html ? markerCode(html) : null;
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
      diagnostics: {
        htmlLength: html.length,
        titleItems: titleItems.length,
        tableItems: tableItems.length,
        lineItems: lineItems.length,
      },
    });
  } catch (e) {
    const err = e instanceof ImportError ? e : new ImportError(e instanceof Error ? e.message : "Falha inesperada.", "UNKNOWN");
    const expected = ["CAPTCHA_REQUIRED", "BLOCKED", "NO_ITEMS", "QR_FORMAT", "NOT_FOUND"].includes(err.code);
    return reply({
      error: err.message,
      code: err.code,
      blocked: expected,
      suggestPhoto: expected,
      finalUrl: err.finalUrl,
      traceId,
    }, expected ? 200 : 500);
  }
});
