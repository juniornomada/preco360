// Self-contained server validation avoids TS NodeNext extension resolution
// failures in the Vercel function bundle. Keep in sync with client predicate.
function isOfficialSpNfceQrUrl(value: string): boolean {
  try {
    if (!value || value.length > 1200) return false;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (url.hostname !== "www.nfce.fazenda.sp.gov.br" &&
        url.hostname !== "nfce.fazenda.sp.gov.br") return false;
    if (url.pathname.toLowerCase() !== "/nfceconsultapublica/paginas/consultaqrcode.aspx") {
      return false;
    }
    const params = [...url.searchParams.keys()];
    if (params.length !== 1 || params[0].toLowerCase() !== "p") return false;
    const p = url.searchParams.get(params[0]) ?? "";
    return /^\d{44}\|[A-Za-z0-9|.\-]{5,300}$/.test(p);
  } catch {
    return false;
  }
}

const MAX_REQUEST_BYTES = 1600;
const MAX_PAGE_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 14000;

function reply(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function allowedRedirect(from: URL, to: URL): boolean {
  if (to.protocol !== "https:" || to.username || to.password || to.port) return false;
  if (!["www.nfce.fazenda.sp.gov.br", "nfce.fazenda.sp.gov.br"].includes(to.hostname)) return false;
  if (!to.pathname.toLowerCase().startsWith("/nfceconsultapublica/")) return false;
  return from.hostname === to.hostname || to.hostname.endsWith("nfce.fazenda.sp.gov.br");
}

async function limitedHtml(response: Response): Promise<string> {
  const size = Number(response.headers.get("content-length") || 0);
  if (size > MAX_PAGE_BYTES) throw new Error("HTML_TOO_LARGE");
  if (!response.body) throw new Error("EMPTY_RESPONSE");

  let total = 0;
  const decoder = new TextDecoder();
  let content = "";
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PAGE_BYTES) throw new Error("HTML_TOO_LARGE");
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    return content;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Alternate transport only. This does NOT bypass SEFAZ access controls.
 * Vercel and Supabase have different outgoing network paths. The Vercel
 * route retrieves official HTML; the existing Supabase function still
 * parses the HTML (body: { pageText }). No scraping from a third party.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);

    const type = request.headers.get("content-type") || "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return reply({ error: "INVALID_CONTENT_TYPE" }, 415);
    }
    const length = Number(request.headers.get("content-length") || "0");
    if (length > MAX_REQUEST_BYTES) return reply({ error: "REQUEST_TOO_LARGE" }, 413);

    try {
      const input = await request.text();
      if (input.length > MAX_REQUEST_BYTES) return reply({ error: "REQUEST_TOO_LARGE" }, 413);
      const body = JSON.parse(input) as { url?: unknown };
      if (typeof body?.url !== "string" || !isOfficialSpNfceQrUrl(body.url)) {
        return reply({ error: "INVALID_NFCE_SP_URL" }, 400);
      }

      let current = new URL(body.url);
      for (let redirect = 0; redirect < 3; redirect++) {
        let response: Response;
        try {
          response = await fetch(current, {
            redirect: "manual",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
              accept: "text/html,application/xhtml+xml",
              "accept-language": "pt-BR,pt;q=0.9",
            },
          });
        } catch (error) {
          // Avoid logging the full QR query/access key.
          console.warn("[nfce-sp-transport] network failure", {
            type: error instanceof Error ? error.name : "unknown",
            message: error instanceof Error ? error.message : "fetch failed",
          });
          return reply({ error: "UPSTREAM_NETWORK", source: "vercel" }, 502);
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) return reply({ error: "BAD_REDIRECT", source: "vercel" }, 502);
          const next = new URL(location, current);
          if (!allowedRedirect(current, next)) {
            return reply({ error: "UNEXPECTED_REDIRECT", source: "vercel" }, 502);
          }
          current = next;
          continue;
        }

        if (response.status === 403 || response.status === 429) {
          return reply({ error: "SEFAZ_ACCESS_DENIED", source: "vercel" }, 502);
        }
        if (!response.ok) {
          return reply({ error: "SEFAZ_HTTP_ERROR", status: response.status, source: "vercel" }, 502);
        }
        const html = await limitedHtml(response);
        if (!html.trim()) return reply({ error: "EMPTY_HTML", source: "vercel" }, 502);
        return reply({ html, source: "vercel" });
      }
      return reply({ error: "TOO_MANY_REDIRECTS", source: "vercel" }, 502);
    } catch (error) {
      const code = error instanceof Error && error.message === "HTML_TOO_LARGE"
        ? "HTML_TOO_LARGE" : "PROXY_FAILED";
      return reply({ error: code, source: "vercel" }, 502);
    }
  },
};
