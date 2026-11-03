import { describe, expect, it } from "vitest";
import {
  isReceiptServerTransportFailure,
  offersReceiptFileRecovery,
  receiptImportErrorDescription,
} from "./receiptImportNetworkRecovery";

describe("NFC-e network error recovery", () => {
  it("classifies actual UPSTREAM_NETWORK from Supabase separately", () => {
    expect(isReceiptServerTransportFailure("UPSTREAM_NETWORK")).toBe(true);
    expect(isReceiptServerTransportFailure("PORTAL_REJECTED")).toBe(false);
    expect(isReceiptServerTransportFailure("BLOCKED")).toBe(false);
  });

  it("offers files for server connection failure and known portal rejection", () => {
    expect(offersReceiptFileRecovery("UPSTREAM_NETWORK")).toBe(true);
    expect(offersReceiptFileRecovery("PORTAL_REJECTED")).toBe(true);
    expect(offersReceiptFileRecovery("NO_ITEMS")).toBe(false);
  });

  it("explains the server failure without claiming the receipt is offline", () => {
    const message = receiptImportErrorDescription(
      "UPSTREAM_NETWORK",
      "Não foi possível conectar após 3 tentativas.",
    );
    expect(message).toContain("servidor do Preço 360");
    expect(message).toContain("navegador");
    expect(message).toContain("PDF");
    expect(message).not.toContain("instabilidade temporária");
  });

  it("preserves error messages for unrelated errors", () => {
    expect(receiptImportErrorDescription("CAPTCHA_REQUIRED", "Valide CAPTCHA"))
      .toBe("Valide CAPTCHA");
    expect(receiptImportErrorDescription("NO_ITEMS", "Itens não encontrados"))
      .toBe("Itens não encontrados");
  });
});
