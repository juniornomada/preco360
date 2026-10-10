import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PAGE_URL =
  "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx";
const CAPTCHA_URL =
  "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Captcha/RandomImageHandler.ashx";

type SessionState = {
  cookies: string;
  hidden: Record<string, string>;
  createdAt: number;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hmac(value: string) {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Segredo do servidor indisponível.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(sig));
}

async function verifyTicket(ticket: string) {
  const [payload, signature] = ticket.split(".");
  if (!payload || !signature) return false;
  const expected = await hmac(payload);
  if (expected.length !== signature.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) return false;

  try {
    const data = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload)),
    );
    return (
      typeof data?.exp === "number" &&
      data.exp >= Date.now() &&
      data.exp <= Date.now() + 10 * 60 * 1000
    );
  } catch {
    return false;
  }
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

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36";

async function captchaFor(state: SessionState) {
  const response = await fetch(
    `${CAPTCHA_URL}?r=${encodeURIComponent(crypto.randomUUID())}`,
    {
      headers: {
        Cookie: state.cookies,
        Referer: PAGE_URL,
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      redirect: "manual",
    },
  );
  if (!response.ok) {
    throw new Error(`SEFAZ não retornou o CAPTCHA (HTTP ${response.status}).`);
  }

  state.cookies = mergeCookies(state.cookies, response.headers);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mime = response.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

async function startSession() {
  const response = await fetch(PAGE_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`SEFAZ respondeu HTTP ${response.status}.`);
  }

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

async function fetchFollowingRedirects(
  state: SessionState,
  input: {
    url: string;
    method: string;
    body?: string;
    headers?: Record<string, string>;
  },
) {
  let url = input.url;
  let method = input.method;
  let body = input.body;
  let referer = PAGE_URL;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9",
      Cookie: state.cookies,
      Referer: referer,
      ...(method === "POST"
        ? {
            Origin: "https://www.nfce.fazenda.sp.gov.br",
            "Content-Type": "application/x-www-form-urlencoded",
          }
        : {}),
      ...(input.headers ?? {}),
    };

    const response = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      redirect: "manual",
    });

    state.cookies = mergeCookies(state.cookies, response.headers);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return response;

      const nextUrl = new URL(location, url).toString();
      referer = url;
      url = nextUrl;

      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        method = "GET";
        body = undefined;
      }
      continue;
    }

    return response;
  }

  throw new Error("A SEFAZ excedeu o número de redirecionamentos.");
}

function plainText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function invalidCaptcha(html: string) {
  const text = plainText(html).toLowerCase();
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
    lower.includes("consulta resumida") ||
    lower.includes("vl. total") ||
    lower.includes("qtd.:") ||
    lower.includes("qtd:")
  );
}

function sefazMessage(html: string) {
  const candidates = [
    html.match(/id=["']spnErroMaster["'][^>]*>([\s\S]*?)<\/span>/i)?.[1],
    html.match(/class=["'][^"']*corTextoErro[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1],
  ]
    .filter(Boolean)
    .map((value) => plainText(String(value)))
    .filter(Boolean);

  return candidates[0] ?? "";
}

async function submitQuery(
  state: SessionState,
  key: string,
  captcha: string,
) {
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(state.hidden)) {
    form.set(name, value);
  }
  form.set("ctl00$Conteudo$txtChaveAcesso", key);
  form.set("ctl00$Conteudo$ctlCaptcha$txCodigo", captcha);
  form.set("ctl00$Conteudo$btnConsultaResumida", "Consultar");

  const response = await fetchFollowingRedirects(state, {
    url: PAGE_URL,
    method: "POST",
    body: form.toString(),
  });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(`SEFAZ respondeu HTTP ${response.status}.`);
  }
  return html;
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

Deno.serve(async (req: Request) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("WebSocket required", { status: 426 });
  }

  const url = new URL(req.url);
  const ticket = url.searchParams.get("ticket") || "";
  if (!ticket || !(await verifyTicket(ticket))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req, {
    idleTimeout: 0,
  });

  let state: SessionState | null = null;
  let busy = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  // Mantém a mesma execução viva enquanto o usuário lê e digita o CAPTCHA.
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Runtime.
  EdgeRuntime.waitUntil(closed);

  socket.onopen = async () => {
    try {
      const started = await startSession();
      state = started.state;
      send(socket, {
        type: "captcha",
        captcha_image: started.captchaImage,
        expires_in_seconds: 180,
      });
    } catch (error) {
      send(socket, {
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível abrir a sessão da SEFAZ-SP.",
      });
    }
  };

  socket.onmessage = async (event) => {
    if (busy) return;

    let message: any;
    try {
      message = JSON.parse(String(event.data || "{}"));
    } catch {
      send(socket, { type: "error", message: "Mensagem inválida." });
      return;
    }

    if (message?.type === "refresh") {
      busy = true;
      try {
        const started = await startSession();
        state = started.state;
        send(socket, {
          type: "captcha",
          captcha_image: started.captchaImage,
          expires_in_seconds: 180,
        });
      } catch (error) {
        send(socket, {
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Não foi possível gerar uma nova imagem.",
        });
      } finally {
        busy = false;
      }
      return;
    }

    if (message?.type !== "submit") return;

    const key = String(message?.key || "").replace(/\D/g, "");
    const captcha = String(message?.captcha || "").trim();

    if (!/^\d{44}$/.test(key) || !captcha || captcha.length > 12) {
      send(socket, {
        type: "retry",
        message: "Confira a chave e os caracteres do CAPTCHA.",
      });
      return;
    }
    if (!state) {
      send(socket, {
        type: "error",
        message: "A sessão ainda não está pronta. Gere uma nova imagem.",
      });
      return;
    }

    busy = true;
    try {
      const html = await submitQuery(state, key, captcha);

      if (!isResultPage(html)) {
        const serverMessage = sefazMessage(html);
        state.hidden = hiddenFields(html);

        if (!state.hidden.__VIEWSTATE) {
          const started = await startSession();
          state = started.state;
          send(socket, {
            type: "captcha",
            captcha_image: started.captchaImage,
            message:
              serverMessage ||
              "A SEFAZ não aceitou a consulta. Tente a nova imagem.",
          });
          return;
        }

        const captchaImage = await captchaFor(state);
        send(socket, {
          type: "captcha",
          captcha_image: captchaImage,
          message:
            serverMessage ||
            (invalidCaptcha(html)
              ? "O CAPTCHA não foi aceito. Digite a nova imagem."
              : "A SEFAZ não concluiu a consulta. Tente a nova imagem."),
        });
        return;
      }

      send(socket, {
        type: "result",
        html,
      });
    } catch (error) {
      send(socket, {
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível concluir a consulta.",
      });
    } finally {
      busy = false;
    }
  };

  socket.onerror = () => {
    resolveClosed();
  };
  socket.onclose = () => {
    resolveClosed();
  };

  return response;
});
