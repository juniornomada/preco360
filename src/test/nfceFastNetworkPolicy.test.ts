import { describe, expect, it } from "vitest";
import { fiscalNetworkAttemptCount } from "../../supabase/functions/fetch-receipt-url/networkPolicy";

const canonical = new URL(
  "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" +
  "3".repeat(44) + "|2|1|1|" + "a".repeat(40),
);
const short = new URL(
  "https://www.nfce.fazenda.sp.gov.br/qrcode?p=" +
  "3".repeat(44) + "|2|1|1|" + "a".repeat(40),
);

describe("Single upstream request for fresh NFC-e QR invocations", () => {
  it("uses only one fetch per invocation for opted-in official SP QR URLs", () => {
    expect(fiscalNetworkAttemptCount(canonical, true)).toBe(1);
    expect(fiscalNetworkAttemptCount(short, true)).toBe(1);
  });

  it("does not change existing behavior unless the client explicitly opts in", () => {
    expect(fiscalNetworkAttemptCount(canonical, undefined)).toBe(3);
    expect(fiscalNetworkAttemptCount(canonical, false)).toBe(3);
    expect(fiscalNetworkAttemptCount(canonical, "true")).toBe(3);
  });

  it.each([
    "https://example.com/qrcode?p=abc",
    "https://www.nfce.fazenda.sp.gov.br.evil.example/qrcode?p=abc",
    "http://www.nfce.fazenda.sp.gov.br/qrcode?p=abc",
    "https://www.nfce.fazenda.sp.gov.br/qrcode",
    "https://www.nfce.fazenda.sp.gov.br/admin?p=abc",
    "https://nfce.fazenda.sp.gov.br/qrcode?p=abc",
    "https://www.nfce.fazenda.sp.gov.br.evil.example/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=abc",
  ])("keeps default retries for other origins or invalid QR routes (%s)", (url) => {
    expect(fiscalNetworkAttemptCount(new URL(url), true)).toBe(3);
  });
});
