/**
 * Classify public NFC-e QR Code v2 without changing its URL or fiscal data.
 * National manual: 5 p-segments = online issue, 8 = offline contingency.
 * This is diagnostic only; classification does not establish reachability.
 */
export type SpNfceQrDiagnostics = {
  emission: "online" | "contingency" | "unknown";
  endpoint: "short" | "long" | "other";
};

export function describeSpNfceQr(input: string): SpNfceQrDiagnostics | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" ||
        url.hostname !== "www.nfce.fazenda.sp.gov.br") return null;
    const path = url.pathname.toLowerCase();
    const endpoint = path === "/qrcode"
      ? "short"
      : path === "/nfceconsultapublica/paginas/consultaqrcode.aspx"
        ? "long"
        : "other";
    if (endpoint === "other") return null;
    const p = url.searchParams.get("p") ?? "";
    const parts = p.split("|");
    const key = parts[0] ?? "";
    if (key.length !== 44 || !/^\d+$/.test(key) ||
        key.slice(0, 2) !== "35" || key.slice(20, 22) !== "65" ||
        parts[1] !== "2") return null;
    const emission = parts.length === 5
      ? "online"
      : parts.length === 8
        ? "contingency"
        : "unknown";
    return { emission, endpoint };
  } catch {
    return null;
  }
}

export function spNfceQrDisplayLabel(input: string): string | null {
  const d = describeSpNfceQr(input);
  if (!d) return null;
  const qrLabel = d.emission === "online" ? "QR online" :
    d.emission === "contingency" ? "QR em contingência offline" :
    "QR versão 2";
  const pathLabel = d.endpoint === "short" ? "/qrcode" :
    "/ConsultaQRCode.aspx";
  return `${qrLabel} · ${pathLabel}`;
}
