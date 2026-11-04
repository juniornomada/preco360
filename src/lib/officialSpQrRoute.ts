/**
 * SEFAZ-SP lists two official public NFC-e QR consultation endpoints:
 * /qrcode and /NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx.
 *
 * Keep the QR payload byte-for-byte as encoded by URL.search while varying
 * ONLY the official endpoint path on even numbered invocations after an
 * UPSTREAM_NETWORK reset. This is a diagnostic route experiment, NOT a way
 * around a portal's access controls. No retry for CAPTCHA/403/429/rejections.
 */
export const SP_SHORT_QR_PATH = "/qrcode";
export const SP_LONG_QR_PATH = "/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx";

export type SpQrFormat = "online" | "offline";

export type SpQrRoute = {
  format: SpQrFormat;
  originalPath: "short" | "long";
  alternateUrl: string;
};

export function parseOfficialSpNfceQrRoute(input: string): SpQrRoute | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" ||
        url.hostname !== "www.nfce.fazenda.sp.gov.br" ||
        url.username || url.password || url.port || url.hash) return null;
    const current = url.pathname.toLowerCase();
    if (current !== SP_SHORT_QR_PATH &&
        current !== SP_LONG_QR_PATH.toLowerCase()) return null;

    const keys = Array.from(url.searchParams.keys());
    if (keys.length !== 1 || keys[0] !== "p") return null;

    const payload = url.searchParams.get("p") ?? "";
    const segments = payload.split("|");
    // QR v2: 5 segments when issued online; 8 when issued in offline
    // contingency. Both formats are defined by the national NFC-e manual.
    if (segments.length !== 5 && segments.length !== 8) return null;
    if (!/^\d{44}$/.test(segments[0]) ||
        segments[0].slice(0, 2) !== "35" ||
        segments[0].slice(20, 22) !== "65" ||
        segments[1] !== "2" ||
        segments[2] !== "1") return null;

    const originalPath = current === SP_SHORT_QR_PATH ? "short" : "long";
    const alternate = new URL(url.toString());
    alternate.pathname = originalPath === "short" ? SP_LONG_QR_PATH : SP_SHORT_QR_PATH;
    // URL.pathname replacement keeps the exact original search string.
    if (alternate.search !== url.search) return null;
    return {
      format: segments.length === 5 ? "online" : "offline",
      originalPath,
      alternateUrl: alternate.toString(),
    };
  } catch {
    return null;
  }
}

/**
 * Attempts 1/3/5 use the scanned URL unchanged, attempts 2/4/6 try the
 * other officially published SEFAZ-SP path with the same signed QR payload.
 * No additional attempts are made beyond the existing six-call limit.
 */
export function officialSpQrUrlForAttempt(originalUrl: string, number: number) {
  const route = parseOfficialSpNfceQrRoute(originalUrl);
  const alternate = route !== null && number >= 2 && number % 2 === 0;
  return {
    url: alternate ? route.alternateUrl : originalUrl,
    alternate,
    format: route?.format ?? null,
  };
}
