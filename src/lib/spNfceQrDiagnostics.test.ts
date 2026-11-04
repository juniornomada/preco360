import { describe, expect, it } from "vitest";
import { describeSpNfceQr, spNfceQrDisplayLabel } from "./spNfceQrDiagnostics";

const key = "35" + "2611" + "1".repeat(14) + "65" + "3".repeat(22);
const online = "https://www.nfce.fazenda.sp.gov.br/qrcode?p=" +
  [key, "2", "1", "1", "A".repeat(40)].join("|");
const offline = "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" +
  [key, "2", "1", "29", "164.14", "x".repeat(56), "1", "B".repeat(40)].join("|");

describe("SP fiscal QR v2 formats", () => {
  it("classifies five online fields and eight contingency fields", () => {
    expect(describeSpNfceQr(online)).toEqual({ emission: "online", endpoint: "short" });
    expect(describeSpNfceQr(offline)).toEqual({ emission: "contingency", endpoint: "long" });
  });
  it("does not expose the access key in the diagnostic label", () => {
    expect(spNfceQrDisplayLabel(online)).toBe("QR online · /qrcode");
    expect(spNfceQrDisplayLabel(offline)).toBe(
      "QR em contingência offline · /ConsultaQRCode.aspx",
    );
    expect(spNfceQrDisplayLabel(online)).not.toContain(key);
  });
  it("does not classify an invalid QR payload", () => {
    expect(describeSpNfceQr("https://www.nfce.fazenda.sp.gov.br/qrcode?p=invalid")).toBeNull();
  });
});
