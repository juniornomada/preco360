import { describe, expect, it } from "vitest";
import {
  officialSpQrUrlForAttempt,
  parseOfficialSpNfceQrRoute,
} from "./officialSpQrRoute";

const key = "35" + "2611" + "1".repeat(14) + "65" + "2".repeat(22);
const online = "https://www.nfce.fazenda.sp.gov.br/qrcode?p=" +
  [key, "2", "1", "1", "A".repeat(40)].join("|");
const offline = "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" +
  [key, "2", "1", "29", "164.14", "x".repeat(56), "1", "B".repeat(40)].join("|");

describe("SP NFC-e official QR route alternation", () => {
  it("recognizes standard online and contingency offline NFC-e", () => {
    expect(parseOfficialSpNfceQrRoute(online)?.format).toBe("online");
    expect(parseOfficialSpNfceQrRoute(offline)?.format).toBe("offline");
  });

  it.each([online, offline])("preserves the QR query verbatim", original => {
    const alternate = parseOfficialSpNfceQrRoute(original)?.alternateUrl;
    expect(alternate).toBeTruthy();
    expect(new URL(alternate!).search).toBe(new URL(original).search);
    expect(new URL(alternate!).pathname).not.toBe(new URL(original).pathname);
  });

  it("alternates on attempts 2, 4 and 6 only", () => {
    for (let n = 1; n <= 6; n++) {
      const candidate = officialSpQrUrlForAttempt(online, n);
      expect(candidate.alternate).toBe(n % 2 === 0);
      expect(new URL(candidate.url).search).toBe(new URL(online).search);
    }
  });

  it.each([
    "http://www.nfce.fazenda.sp.gov.br/qrcode?p=" + key,
    "https://nfce.fazenda.sp.gov.br/qrcode?p=" + key,
    "https://www.nfce.fazenda.sp.gov.br/private?p=" + key,
    "https://www.nfce.fazenda.sp.gov.br/qrcode?p=invalid",
    online + "&extra=1",
  ])("never changes links outside the precise allowlist", (input) => {
    expect(parseOfficialSpNfceQrRoute(input)).toBeNull();
    expect(officialSpQrUrlForAttempt(input, 2).url).toBe(input);
  });
});
