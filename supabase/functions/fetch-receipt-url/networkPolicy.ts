/**
 * Decide how many HTTP requests to the fiscal portal are made within one
 * Supabase Edge invocation.
 *
 * An opt-in Chrome NFC-e QR import uses a single try before a fresh Edge
 * invocation takes over. This avoids repeated waits on the same failing
 * upstream connection. All other calls preserve the legacy three attempts.
 */
export function fiscalNetworkAttemptCount(
  url: URL,
  fastQrNetwork: unknown,
): 1 | 3 {
  if (fastQrNetwork !== true) return 3;
  if (url.protocol !== "https:") return 3;
  if (url.hostname !== "www.nfce.fazenda.sp.gov.br") return 3;
  if (![
    "/qrcode",
    "/nfceconsultapublica/paginas/consultaqrcode.aspx",
  ].includes(url.pathname.toLowerCase())) return 3;
  if (!url.searchParams.has("p")) return 3;
  return 1;
}
