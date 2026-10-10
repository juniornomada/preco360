import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE_URL =
  "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx";
const CAPTCHA_URL =
  "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Captcha/RandomImageHandler.ashx";

type SessionState = {
  cookies: string;
  hidden: Record<string, string>;
  createdAt: number;
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function htmlDecode(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#32;/g, " ");
}

function hiddenFields(html: string) {
  const out: Record<string, string> = {};
  const re = /<input\b[^>]*type=["']hidden["'][^>]*>/gi;
  for (const match of html.match(re) ?? []) {
    const name = match.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    const value = match.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? "";
    out[htmlDecode(name)] = htmlDecode(value);
  }
  return out;
}

function cookiePairs(headers: Headers) {
  const getter = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const raw =
    typeof getter === "function"
      ? getter.call(headers)
      : headers.get("set-cookie")
        ? [headers.get("set-cookie") as string]
        : [];

  return raw
    .flatMap((line) => line.split(/,(?=[^;,]+=)/g))
    .map((line) => line.trim().split(";")[0])
    .filter(Boolean);
}

function mergeCookies(current: string, headers: Headers) {
  const map = new Map<string, string>();
  for (const pair of current.split(";").map((x) => x.trim()).filter(Boolean)) {
    const idx = pair.indexOf("=");
    if (idx > 0) map.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  for (const pair of cookiePairs(headers)) {
    const idx = pair.indexOf("=");
    if (idx > 0) map.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function encodeState(state: SessionState) {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(state)));
}

function decodeState(token: string): SessionState {
  const binary = atob(token);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !value ||
    typeof value.cookies !== "string" ||
    !value.hidden ||
    typeof value.hidden !== "object" ||
    typeof value.createdAt !== "number"
  ) {
    throw new Error("Sessão inválida.");
  }
  if (Date.now() - value.createdAt > 15 * 60 * 1000) {
    throw new Error("A sessão do CAPTCHA expirou. Gere uma nova imagem.");
  }
  return value as SessionState;
}

async function captchaFor(state: SessionState) {
  const response = await fetch(
    `${CAPTCHA_URL}?r=${encodeURIComponent(crypto.randomUUID())}`,
    {
      headers: {
        Cookie: state.cookies,
        Referer: PAGE_URL,
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
      },
      redirect: "manual",
    },
  );
  if (!response.ok) throw new Error(`SEFAZ não retornou o CAPTCHA (HTTP ${response.status}).`);

  state.cookies = mergeCookies(state.cookies, response.headers);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mime = response.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

async function startSession() {
  const response = await fetch(PAGE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`SEFAZ respondeu HTTP ${response.status}.`);

  const html = await response.text();
  const state: SessionState = {
    cookies: mergeCookies("", response.headers),
    hidden: hiddenFields(html),
    createdAt: Date.now(),
  };
  if (!state.hidden.__VIEWSTATE) {
    throw new Error("A SEFAZ mudou o formulário da consulta.");
  }
  const captchaImage = await captchaFor(state);
  return { state, captchaImage };
}

function invalidCaptcha(html: string) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  return (
    (text.includes("imagem") || text.includes("captcha")) &&
    (text.includes("inválid") ||
      text.includes("invalido") ||
      text.includes("incorret") ||
      text.includes("não confere") ||
      text.includes("nao confere"))
  );
}

function isResultPage(html: string) {
  const lower = html.toLowerCase();
  return (
    lower.includes("documento auxiliar da nota fiscal de consumidor") ||
    lower.includes("vl. total") ||
    lower.includes("qtd.:") ||
    lower.includes("qtd:")
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "start");

    if (action === "start") {
      const { state, captchaImage } = await startSession();
      return reply(200, {
        ok: true,
        captcha_image: captchaImage,
        session_token: encodeState(state),
        expires_in_seconds: 900,
      });
    }

    if (action !== "submit") {
      return reply(400, { error: "INVALID_ACTION" });
    }

    const key = String(body?.key || "").replace(/\D/g, "");
    const captcha = String(body?.captcha || "").trim();
    if (!/^\d{44}$/.test(key)) {
      return reply(400, { error: "INVALID_KEY", message: "Informe uma chave válida de 44 dígitos." });
    }
    if (!captcha || captcha.length > 12) {
      return reply(400, { error: "INVALID_CAPTCHA", message: "Digite os caracteres do CAPTCHA." });
    }

    const state = decodeState(String(body?.session_token || ""));
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(state.hidden)) {
      form.set(name, value);
    }
    form.set("ctl00$Conteudo$txtChaveAcesso", key);
    form.set("ctl00$Conteudo$ctlCaptcha$txCodigo", captcha);
    form.set("ctl00$Conteudo$btnConsultaResumida", "Consultar");

    const response = await fetch(PAGE_URL, {
      method: "POST",
      headers: {
        Cookie: state.cookies,
        Referer: PAGE_URL,
        Origin: "https://www.nfce.fazenda.sp.gov.br",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      body: form.toString(),
      redirect: "follow",
    });

    state.cookies = mergeCookies(state.cookies, response.headers);
    const html = await response.text();

    if (!response.ok) {
      return reply(502, {
        error: "SEFAZ_HTTP_ERROR",
        message: `SEFAZ respondeu HTTP ${response.status}.`,
      });
    }

    if (invalidCaptcha(html) || !isResultPage(html)) {
      state.hidden = hiddenFields(html);
      if (!state.hidden.__VIEWSTATE) {
        const fresh = await startSession();
        return reply(200, {
          ok: false,
          code: "CAPTCHA_RETRY",
          message: "O CAPTCHA não foi aceito ou expirou. Tente a nova imagem.",
          captcha_image: fresh.captchaImage,
          session_token: encodeState(fresh.state),
        });
      }

      const captchaImage = await captchaFor(state);
      return reply(200, {
        ok: false,
        code: "CAPTCHA_RETRY",
        message: "O CAPTCHA não foi aceito, expirou ou a chave não retornou a consulta. Tente a nova imagem.",
        captcha_image: captchaImage,
        session_token: encodeState(state),
      });
    }

    return reply(200, {
      ok: true,
      html,
    });
  } catch (error) {
    return reply(500, {
      error: "SEFAZ_SESSION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Não foi possível iniciar a consulta da SEFAZ-SP.",
    });
  }
});
