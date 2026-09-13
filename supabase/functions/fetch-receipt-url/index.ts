import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

class SefazError extends Error {
  code: string;
  finalUrl?: string;
  constructor(message: string, code: string, finalUrl?: string) {
    super(message);
    this.code = code;
    this.finalUrl = finalUrl;
  }
}

// ---------- Telemetria ----------
type LogLevel = "info" | "warn" | "error";

function createTracer(traceId: string) {
  const t0 = Date.now();
  const marks: Record<string, number> = {};

  const log = (level: LogLevel, step: string, data: Record<string, unknown> = {}) => {
    const line = JSON.stringify({
      fn: "fetch-receipt-url",
      traceId,
      step,
      level,
      elapsedMs: Date.now() - t0,
      ...data,
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  const mark = (name: string) => {
    marks[name] = Date.now() - t0;
  };

  return { log, mark, marks, elapsed: () => Date.now() - t0 };
}

/** Remove dados sensíveis/ruído das URLs antes de logar */
function redactUrl(raw: string) {
  try {
    const u = new URL(raw);
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      // mascara chave de acesso (44 dígitos), mantendo início/fim para depuração
      params[k] = v.length > 20 ? `${v.slice(0, 6)}…${v.slice(-6)} (len=${v.length})` : v;
    });
    return { host: u.host, path: u.pathname, params };
  } catch {
    return { host: "invalid", path: raw.slice(0, 60), params: {} };
  }
}

/** Marcadores encontrados no HTML — ajuda a entender por que a leitura falhou */
function detectMarkers(htmlLower: string) {
  const checks: Record<string, boolean> = {
    captcha: /captcha|randomimagehandler|digite os caracteres da imagem/.test(htmlLower),
    recaptcha: /g-recaptcha|recaptcha\/api\.js/.test(htmlLower),
    hcaptcha: htmlLower.includes("hcaptcha"),
    qrFormat: /formato de qr-code não suportado|qr-?code inválido/.test(htmlLower),
    notFound: /nfc-e não encontrada|nfe não encontrada|documento não localizado/.test(htmlLower),
    unavailable: /sistema indisponível|serviço indisponível|maintenance/.test(htmlLower),
    invalidKey: /chave de acesso inválida|chave inválida/.test(htmlLower),
    hasTable: htmlLower.includes("<table"),
    hasProdutos: htmlLower.includes("produto"),
  };
  return Object.entries(checks)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

/** Converte HTML em texto visível (remove script/style/tags) */
function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Alternativas de consulta quando a página principal exige CAPTCHA/JS.
 * Muitas SEFAZ expõem o mesmo cupom em endpoints de QR Code sem verificação.
 */
function candidateUrls(originalHref: string): string[] {
  const list = [originalHref];
  const key = originalHref.match(/\d{44}/)?.[0];
  if (key) {
    const uf = key.slice(0, 2);
    const qr = `${key}|2|1|1`;
    if (uf === "35") {
      list.push(`https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${qr}`);
      list.push(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${qr}`);
    }
    try {
      const u = new URL(originalHref);
      if (!u.searchParams.has("p")) {
        u.searchParams.delete("chNFe");
        u.searchParams.set("p", qr);
        list.push(u.toString());
      }
    } catch {
      /* ignora */
    }
  }
  return [...new Set(list)];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = crypto.randomUUID().slice(0, 8);
  const { log, mark, marks, elapsed } = createTracer(traceId);
  let telemetry: Record<string, unknown> = {};

  try {
    const body = await req.json();
    const url = body?.url;
    const pageText: string | undefined =
      typeof body?.pageText === "string" ? body.pageText : undefined;
    log("info", "request_received", {
      hasUrl: Boolean(url),
      hasPageText: Boolean(pageText),
      client: req.headers.get("x-client-info") ?? undefined,
    });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      log("error", "config_missing", { key: "LOVABLE_API_KEY" });
      throw new Error("LOVABLE_API_KEY not configured");
    }

    let visibleText = "";

    // ---------- Caminho A: usuário colou o conteúdo da página já resolvida ----------
    if (pageText && pageText.trim().length > 0) {
      const cleaned = /<[a-z][\s\S]*>/i.test(pageText) ? htmlToText(pageText) : pageText.replace(/\s+/g, " ").trim();
      log("info", "page_text_received", { chars: cleaned.length, hasPriceLike: /\d+[.,]\d{2}/.test(cleaned) });
      if (cleaned.length < 200 || !/\d+[.,]\d{2}/.test(cleaned)) {
        throw new SefazError(
          "O conteúdo colado não parece ser a página do cupom (não encontramos produtos nem preços). Selecione tudo na página da SEFAZ (Ctrl+A), copie (Ctrl+C) e cole aqui novamente.",
          "NO_ITEMS"
        );
      }
      visibleText = cleaned;
      telemetry = { ...telemetry, source: "pageText", htmlLength: cleaned.length };
    } else {
      // ---------- Caminho B: buscar na SEFAZ (com endpoints alternativos) ----------
      if (!url || typeof url !== "string") {
        log("warn", "validation_failed", { reason: "missing_url" });
        return new Response(
          JSON.stringify({ error: "URL é obrigatória", code: "MISSING_URL", traceId }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url.trim());
      } catch {
        log("warn", "validation_failed", { reason: "invalid_url", sample: url.slice(0, 60) });
        return new Response(
          JSON.stringify({ error: "URL inválida", code: "INVALID_URL", traceId }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      telemetry = { ...telemetry, target: redactUrl(parsedUrl.href) };

      const candidates = candidateUrls(parsedUrl.href);
      log("info", "candidates_built", { count: candidates.length });

      let lastError: SefazError | null = null;
      const triedUrls: string[] = [];

      for (const candidate of candidates) {
        triedUrls.push(redactUrl(candidate).path);
        try {
          const fetchStart = Date.now();
          const pageResponse = await fetch(candidate, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          mark("sefaz_fetch");

          log("info", "fetch_done", {
            candidate: redactUrl(candidate),
            status: pageResponse.status,
            ok: pageResponse.ok,
            durationMs: Date.now() - fetchStart,
          });

          if (!pageResponse.ok) {
            const status = pageResponse.status;
            if (status === 403 || status === 429) {
              throw new SefazError("A SEFAZ bloqueou o acesso. Tente novamente em alguns minutos.", "BLOCKED");
            }
            if (status === 404) {
              throw new SefazError("Cupom não encontrado. Verifique se a URL ou chave de acesso está correta.", "NOT_FOUND");
            }
            throw new SefazError(`Erro ao acessar a página da SEFAZ: HTTP ${status}`, "HTTP_ERROR");
          }

          const html = await pageResponse.text();
          const htmlLower = html.toLowerCase();
          const finalUrl = pageResponse.url || candidate;
          const wasRedirected = finalUrl.replace(/\/$/, "") !== candidate.replace(/\/$/, "");
          const markers = detectMarkers(htmlLower);

          telemetry = {
            ...telemetry,
            htmlLength: html.length,
            wasRedirected,
            markers,
            triedUrls,
            finalUrl: redactUrl(finalUrl),
          };
          log("info", "page_analyzed", { htmlLength: html.length, wasRedirected, markers });

          if (html.length < 100) {
            throw new SefazError("Página retornou conteúdo vazio. A SEFAZ pode estar fora do ar.", "SEFAZ_DOWN", finalUrl);
          }
          if (/error404|erro404|paginanaoencontrada|notfound/i.test(finalUrl)) {
            throw new SefazError(
              "O link informado não é mais válido na SEFAZ e foi redirecionado para uma página de erro.",
              "REDIRECTED",
              finalUrl
            );
          }
          if (markers.includes("qrFormat")) {
            throw new SefazError(
              "A SEFAZ não aceita apenas a chave de acesso nesse formato. Use a URL completa do QR Code impresso no cupom.",
              "QR_FORMAT",
              finalUrl
            );
          }
          if (markers.includes("captcha") || markers.includes("recaptcha") || markers.includes("hcaptcha")) {
            throw new SefazError(
              "A SEFAZ exige uma verificação CAPTCHA nessa consulta.",
              "CAPTCHA_REQUIRED",
              finalUrl
            );
          }
          if (markers.includes("notFound")) {
            throw new SefazError("Cupom fiscal não encontrado na SEFAZ. Verifique se a URL/chave está correta.", "NOT_FOUND", finalUrl);
          }
          if (markers.includes("unavailable")) {
            throw new SefazError("O sistema da SEFAZ está temporariamente indisponível. Tente novamente mais tarde.", "SEFAZ_DOWN", finalUrl);
          }
          if (markers.includes("invalidKey")) {
            throw new SefazError("Chave de acesso inválida. Verifique se os 44 dígitos estão corretos.", "INVALID_KEY", finalUrl);
          }

          const text = htmlToText(html);
          const hasPriceLike = /\d+[.,]\d{2}/.test(text);
          if (text.length < 900 || !hasPriceLike) {
            log("warn", "js_rendered_page", { visibleChars: text.length, hasPriceLike });
            throw new SefazError(
              "Essa página da SEFAZ só exibe o cupom depois de uma verificação no navegador.",
              "JS_REQUIRED",
              finalUrl
            );
          }

          visibleText = text;
          break;
        } catch (e) {
          lastError = e instanceof SefazError ? e : new SefazError(e?.message ?? "Falha na consulta", "HTTP_ERROR");
          log("warn", "candidate_failed", { candidate: redactUrl(candidate), code: lastError.code });
        }
      }

      if (!visibleText) {
        const err =
          lastError ?? new SefazError("Não foi possível consultar a SEFAZ.", "HTTP_ERROR");
        // Bloqueios: sugerimos as alternativas manuais (colar conteúdo ou foto)
        if (["CAPTCHA_REQUIRED", "JS_REQUIRED", "REDIRECTED", "QR_FORMAT"].includes(err.code)) {
          err.message = `${err.message} Tentamos ${candidates.length} endereço(s) alternativo(s) sem sucesso — cole o conteúdo da página após resolver a verificação, ou envie a foto do cupom.`;
        }
        throw err;
      }
    }

    // Trunca para evitar limites de token (30k chars de texto já é bastante)
    const truncatedHtml = visibleText.length > 30000 ? visibleText.substring(0, 30000) : visibleText;

    const prompt = `Você é um especialista em ler cupons fiscais brasileiros (NFC-e / DANFE).

Analise o TEXTO abaixo, extraído de uma página da SEFAZ (consulta de cupom fiscal via QR Code) e extraia:

1. Nome do supermercado/loja (razão social ou nome fantasia)
2. Data da compra
3. Lista de produtos com nome e preço total (valor final pago por item, não unitário)

REGRAS:
- Use o nome COMPLETO do produto como aparece
- O preço deve ser o valor TOTAL da linha (quantidade × unitário)
- Ignore linhas de total geral, subtotal, troco, desconto, impostos, ICMS
- Ignore cabeçalhos e rodapés
- Preços no JSON devem usar ponto como separador decimal
- Se houver data, formate como YYYY-MM-DD

Texto da página:
"""
${truncatedHtml}
"""

Responda APENAS com JSON válido neste formato exato:
{
  "supermarket": "Nome do Supermercado",
  "date": "2024-01-15",
  "items": [
    {"name": "Nome do Produto", "price": "12.50"},
    {"name": "Outro Produto", "price": "8.99"}
  ]
}`;

    const aiStart = Date.now();
    log("info", "ai_request_start", { model: "google/gemini-2.5-flash", htmlSentChars: truncatedHtml.length });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 8192,
      }),
    });
    mark("ai_call");

    if (!response.ok) {
      const errText = await response.text();
      log("error", "ai_request_failed", {
        status: response.status,
        durationMs: Date.now() - aiStart,
        body: errText.slice(0, 300),
      });
      if (response.status === 429) {
        throw new SefazError("Limite de uso da IA atingido. Tente novamente em instantes.", "AI_RATE_LIMIT");
      }
      if (response.status === 402) {
        throw new SefazError("Créditos de IA esgotados. Recarregue para continuar.", "AI_NO_CREDITS");
      }
      throw new SefazError(`Erro no serviço de IA (HTTP ${response.status})`, "AI_ERROR");
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";
    log("info", "ai_request_done", {
      durationMs: Date.now() - aiStart,
      usage: result.usage,
      contentChars: content.length,
    });

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log("error", "ai_parse_failed", { reason: "no_json", preview: content.slice(0, 200) });
      throw new SefazError("Não foi possível extrair dados do cupom. A página pode não conter um cupom fiscal válido.", "AI_PARSE_ERROR");
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      log("error", "ai_parse_failed", { reason: "invalid_json", preview: jsonMatch[0].slice(0, 200) });
      throw new SefazError("Erro ao interpretar os dados extraídos. Tente novamente.", "AI_PARSE_ERROR");
    }

    const rawItemCount = Array.isArray(parsed.items) ? parsed.items.length : 0;

    if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      log("warn", "no_items_extracted", { telemetry });
      throw new SefazError(
        "Não conseguimos ler os produtos nessa página da SEFAZ (ela pode estar incompleta ou protegida). Cole o conteúdo da página ou envie a foto do cupom.",
        "NO_ITEMS",
        (telemetry as any)?.finalUrl?.path
      );
    }

    // Filter out items with invalid prices
    parsed.items = parsed.items.filter((item: any) => {
      const price = parseFloat(item.price);
      return item.name && item.name.trim().length > 0 && !isNaN(price) && price > 0;
    });

    if (parsed.items.length === 0) {
      log("warn", "items_discarded", { rawItemCount });
      throw new SefazError("Os produtos encontrados não possuem preços válidos.", "NO_ITEMS");
    }

    log("info", "success", {
      supermarket: parsed.supermarket,
      date: parsed.date,
      rawItemCount,
      validItemCount: parsed.items.length,
      discarded: rawItemCount - parsed.items.length,
      marks,
      totalMs: elapsed(),
    });

    return new Response(JSON.stringify({ ...parsed, traceId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const code = error instanceof SefazError ? error.code : "UNKNOWN";
    const blocked = ["CAPTCHA_REQUIRED", "REDIRECTED", "QR_FORMAT", "NO_ITEMS", "JS_REQUIRED"].includes(code);

    log("error", "request_failed", {
      code,
      blocked,
      message: error?.message,
      stack: typeof error?.stack === "string" ? error.stack.split("\n").slice(0, 3).join(" | ") : undefined,
      telemetry,
      marks,
      totalMs: elapsed(),
    });

    return new Response(
      JSON.stringify({
        error: error.message,
        code,
        blocked,
        finalUrl: error?.finalUrl,
        suggestPhoto: blocked,
        traceId,
        diagnostics: {
          markers: (telemetry as any).markers ?? [],
          htmlLength: (telemetry as any).htmlLength ?? null,
          wasRedirected: (telemetry as any).wasRedirected ?? null,
          totalMs: elapsed(),
        },
      }),
      {
        // Bloqueios conhecidos da SEFAZ são resultados esperados do fluxo, não
        // falhas de execução. HTTP 200 evita que o cliente/runtime os transforme
        // em exceções e mantém o diagnóstico disponível para a interface.
        status: blocked ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
