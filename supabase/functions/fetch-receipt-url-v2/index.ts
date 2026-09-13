import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Item = { name: string; price: string };
class ImportError extends Error {
  constructor(message: string, public code: string, public finalUrl?: string) { super(message); }
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
});

const decode = (s: string) => s
  .replace(/&#(x?[0-9a-f]+);/gi, (_, raw) => String.fromCodePoint(raw.toLowerCase().startsWith("x") ? parseInt(raw.slice(1), 16) : parseInt(raw, 10)))
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");

const textOf = (html: string) => decode(html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const linesOf = (html: string) => decode(html
  .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(?:tr|td|th|div|p|li|section|h[1-6])>/gi, "\n")
  .replace(/<[^>]+>/g, " "))
  .split(/\r?\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

function money(raw?: string | null) {
  if (!raw) return null;
  let s = raw.replace(/R\$/gi, "").replace(/\s/g, "");
  if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

function standardItems(html: string): Item[] {
  const re = /<span[^>]*class=["'][^"']*txtTit[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  const hits: Array<{ name: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) hits.push({ name: textOf(m[1]), start: m.index, end: re.lastIndex });
  return hits.flatMap((hit, i) => {
    const chunk = html.slice(hit.end, hits[i + 1]?.start ?? Math.min(html.length, hit.end + 2500));
    const unit = chunk.match(/class=["'][^"']*(?:RvlUnit|vlUnit|valorUnit)[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1];
    const total = chunk.match(/class=["'][^"']*(?:valor|vlTotal|valorTotal)[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1];
    const price = money(unit ? textOf(unit).match(/\d[\d.,]*/)?.[0] : null) ?? money(total ? textOf(total).match(/\d[\d.,]*/)?.[0] : null);
    return hit.name && price ? [{ name: hit.name, price }] : [];
  });
}

const bad = /^(total|subtotal|troco|desconto|valor|qtd|qtde|quantidade|pagamento|tribut|icms|pis|cofins|chave|protocolo|consumidor|cpf|cnpj|data|emiss[aã]o)/i;
function fallbackItems(lines: string[]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 3 || bad.test(line)) continue;
    const same = line.match(/^(.{3,120}?)\s+(?:R\$\s*)?(\d{1,6}[.,]\d{2})$/);
    if (same) { const p = money(same[2]); if (p) out.push({ name: same[1].trim(), price: p }); continue; }
    if (/\d+[.,]\d{2}/.test(line)) continue;
    for (let j = 1; j <= 4 && i + j < lines.length; j++) {
      const next = lines[i + j];
      const p = money(next.match(/(?:Vl\.?\s*Unit\.?|Valor\s*Unit[aá]rio|Vl\.?\s*Total|Valor\s*Total)\s*:?\s*(?:R\$\s*)?(\d{1,6}[.,]\d{2})/i)?.[1] ?? next.match(/^(?:R\$\s*)?(\d{1,6}[.,]\d{2})$/)?.[1]);
      if (p) { out.push({ name: line, price: p }); break; }
    }
  }
  return out;
}

function dedupe(items: Item[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    item.name = item.name.replace(/\s+/g, " ").trim();
    const key = `${item.name.toLowerCase()}|${item.price}`;
    if (!item.name || bad.test(item.name) || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 300);
}

function blocked(html: string, url: string) {
  const lower = html.toLowerCase();
  if (/g-recaptcha|recaptcha\/api\.js|hcaptcha|captcha|digite os caracteres da imagem/.test(lower)) throw new ImportError("A SEFAZ exige CAPTCHA. Resolva a validação na página oficial e cole o conteúdo validado no Preço 360.", "CAPTCHA_REQUIRED", url);
  if (/nfc-e não encontrada|nfe não encontrada|documento não localizado/.test(lower)) throw new ImportError("Cupom não encontrado.", "NOT_FOUND", url);
}

async function fetchFiscal(raw: string) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol) || (!u.hostname.endsWith(".gov.br") && !/(sefaz|fazenda|nfce|nfe|dfe)/i.test(u.hostname))) throw new ImportError("Endereço fiscal inválido.", "INVALID_URL");
  const r = await fetch(u, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,application/xhtml+xml" } });
  const finalUrl = r.url || u.toString();
  if (r.status === 403 || r.status === 429) throw new ImportError("A SEFAZ bloqueou a consulta automática. Use o QR completo ou a validação assistida.", "BLOCKED", finalUrl);
  if (!r.ok) throw new ImportError(`SEFAZ respondeu HTTP ${r.status}.`, "HTTP_ERROR", finalUrl);
  const html = await r.text(); blocked(html, finalUrl); return { html, finalUrl };
}

function store(lines: string[]) {
  for (let i = 0; i < Math.min(25, lines.length); i++) if (/\bCNPJ\b/i.test(lines[i + 1] ?? "")) return lines[i];
  return "";
}
function date(text: string) {
  const m = text.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/); return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const traceId = crypto.randomUUID().slice(0, 8);
  try {
    const body = await req.json();
    let html = ""; let lines: string[] = []; let finalUrl: string | undefined;
    if (typeof body?.pageText === "string" && body.pageText.trim()) {
      const raw = body.pageText.trim(); html = /<[a-z][\s\S]*>/i.test(raw) ? raw : ""; lines = html ? linesOf(html) : raw.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
    } else if (typeof body?.url === "string" && body.url.trim()) {
      const loaded = await fetchFiscal(body.url.trim()); html = loaded.html; finalUrl = loaded.finalUrl; lines = linesOf(html);
    } else throw new ImportError("Informe a URL do QR Code ou o conteúdo da consulta.", "MISSING_URL");

    const items = dedupe((html ? standardItems(html) : []).length ? standardItems(html) : fallbackItems(lines));
    if (!items.length) throw new ImportError("A página abriu, mas não consegui identificar produtos. Use a validação assistida ou uma foto do cupom.", "NO_ITEMS", finalUrl);
    return reply({ supermarket: store(lines), date: date(lines.join(" ")), items, traceId, sourceUrl: finalUrl });
  } catch (e) {
    const err = e instanceof ImportError ? e : new ImportError(e instanceof Error ? e.message : "Falha inesperada.", "UNKNOWN");
    const expected = ["CAPTCHA_REQUIRED", "BLOCKED", "NO_ITEMS"].includes(err.code);
    return reply({ error: err.message, code: err.code, blocked: expected, suggestPhoto: expected, finalUrl: err.finalUrl, traceId }, expected ? 200 : 500);
  }
});
