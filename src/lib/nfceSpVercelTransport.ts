/**
 * Allow only NFC-e QR consultation URLs on the official São Paulo fiscal
 * portal. The same predicate is used by the browser and the Vercel function
 * to prevent the API endpoint from becoming an arbitrary URL fetch proxy.
 */
export function isOfficialSpNfceQrUrl(value: string): boolean {
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
    // Access key + QR specification segments. Never accept arbitrary URLs,
    // query scripts, or unbounded user input in the fiscal serverless proxy.
    return /^\d{44}\|[A-Za-z0-9|.\-]{5,300}$/.test(p);
  } catch {
    return false;
  }
}

/**
 * Client helper: only ask our same-origin Vercel route for a validated SP
 * NFC-e QR URL. This does not access browser cookies or evade SEFAZ controls.
 */
export async function fetchSpNfceHtmlViaVercel(url: string): Promise<string | null> {
  if (!isOfficialSpNfceQrUrl(url)) return null;
  try {
    const response = await fetch("/api/fetch-nfce-sp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(17000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { html?: unknown };
    if (typeof data?.html !== "string" || data.html.length < 50 ||
        data.html.length > 1_500_000) return null;
    return data.html;
  } catch {
    return null;
  }
}
