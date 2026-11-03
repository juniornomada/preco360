import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { validateNfceUrl } from "@/lib/nfceKey";

const OFFICIAL_HOST = "www.nfce.fazenda.sp.gov.br";
const MAX_HTML_CHARACTERS = 1_500_000;
const OFFICIAL_PATHS = new Set([
  "/nfceconsultapublica/paginas/consultaqrcode.aspx",
  "/qrcode",
]);

/**
 * This probe uses native Android HTTPS from the purchaser's phone, rather
 * than a cloud egress IP. It is NOT available to Chrome/PWA users.
 *
 * Native HTTPS may still be refused by the fiscal portal; Chrome succeeding
 * is evidence for an on-device test, not proof that OkHttp will succeed.
 */
export function hasAndroidNativeReceiptTransport(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/**
 * Only the official SP NFC-e QR endpoint can be fetched by native HTTP.
 * The existing NFC-e checksum and QR validator remain mandatory.
 */
export function isOfficialSpNfceForNativeFetch(input: string): boolean {
  try {
    if (!input || input.length > 1400) return false;
    const url = new URL(input);
    if (url.protocol !== "https:" ||
        url.hostname !== OFFICIAL_HOST ||
        url.username || url.password || url.port || url.hash) return false;
    if (!OFFICIAL_PATHS.has(url.pathname.toLowerCase())) return false;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1 || keys[0].toLowerCase() !== "p") return false;
    const payload = url.searchParams.get(keys[0]);
    if (!payload || !/^\d{44}\|/.test(payload)) return false;
    return validateNfceUrl(input).valid;
  } catch {
    return false;
  }
}

function officialRedirect(input: string, from: string): string | null {
  try {
    const url = new URL(input, from);
    const parsed = new URL(from);
    if (url.protocol !== "https:" || url.hostname !== OFFICIAL_HOST ||
        url.username || url.password || url.port || url.hash) return null;
    if (!url.pathname.toLowerCase().startsWith("/nfceconsultapublica/") &&
        url.pathname.toLowerCase() !== "/qrcode") return null;
    // Redirects may change the path but never allow a cross-origin visit.
    if (parsed.origin !== url.origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function responseHeader(headers: Record<string, string>, name: string) {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

export async function fetchOfficialNfceOnAndroid(input: string): Promise<string | null> {
  if (!hasAndroidNativeReceiptTransport() || !isOfficialSpNfceForNativeFetch(input)) {
    return null;
  }

  let nextUrl = input;
  try {
    for (let n = 0; n < 3; n++) {
      const response = await CapacitorHttp.get({
        url: nextUrl,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9",
        },
        connectTimeout: 12000,
        readTimeout: 12000,
        responseType: "text",
        disableRedirects: true,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = responseHeader(response.headers, "location");
        const allowed = location ? officialRedirect(location, nextUrl) : null;
        if (!allowed) return null;
        nextUrl = allowed;
        continue;
      }

      if (response.status !== 200 || typeof response.data !== "string") return null;
      const html = response.data;
      if (html.length < 80 || html.length > MAX_HTML_CHARACTERS) return null;
      // Reject explicit portal refusal and CAPTCHA pages; never bypass them.
      if (/Request Rejected|Access Denied|CAPTCHA_REQUIRED/i.test(html)) return null;
      return html;
    }
  } catch {
    // A device-native request is experimental. Normal QR handling remains
    // the fallback if the native TLS connection also fails.
  }
  return null;
}
