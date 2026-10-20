import { describe, expect, it } from "vitest";
import { checkDigit } from "@/lib/nfceKey";
import { canonicalReceiptRetailerName, receiptCnpjFromAccessKey } from "@/lib/receiptRetailer";

const fakeKey = (cnpj: string) => {
  const partial = "352610" + cnpj + "65" + "001" + "000000001" + "1" + "00000001";
  return partial + checkDigit(partial);
};

describe("receipt retailer by exact issuer CNPJ", () => {
  it("names verified Max Atacadista Marília store by CNPJ from image", () => {
    expect(canonicalReceiptRetailerName("IRMAOS MUFFATO E CIA LTDA", "76.430.438/0138-26"))
      .toBe("Max Atacadista");
    expect(canonicalReceiptRetailerName("Irmãos Muffato & Cia Ltda", "76430438013826"))
      .toBe("Max Atacadista");
  });

  it("works with valid QR access key and rejects invalid key", () => {
    const key = fakeKey("76430438013826");
    expect(receiptCnpjFromAccessKey(key)).toBe("76430438013826");
    expect(canonicalReceiptRetailerName("IRMAOS MUFFATO E CIA LTDA", null, key))
      .toBe("Max Atacadista");
    expect(receiptCnpjFromAccessKey(key.slice(0, -1) + (key.endsWith("9") ? "8" : "9"))).toBeNull();
  });

  it("does not map other Grupo Muffato branches or unspecified CNPJ", () => {
    expect(canonicalReceiptRetailerName("IRMAOS MUFFATO E CIA LTDA")).toBe("IRMAOS MUFFATO E CIA LTDA");
    expect(canonicalReceiptRetailerName("IRMAOS MUFFATO E CIA LTDA", "76.430.438/0050-50"))
      .toBe("IRMAOS MUFFATO E CIA LTDA");
    expect(canonicalReceiptRetailerName("SUPER MUFFATO", "76430438013826")).toBe("SUPER MUFFATO");
  });

  it("never applies banner mapping on conflicting CNPJ", () => {
    expect(canonicalReceiptRetailerName("IRMAOS MUFFATO E CIA LTDA", "76430438000505", fakeKey("76430438013826")))
      .toBe("IRMAOS MUFFATO E CIA LTDA");
  });

  it("keeps existing brands canonical", () => {
    expect(canonicalReceiptRetailerName("MAX ATACADISTA")).toBe("Max Atacadista");
    expect(canonicalReceiptRetailerName("Confiança Supermercados")).toBe("Confiança");
  });
});
