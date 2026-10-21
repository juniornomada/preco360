import { describe, expect, it } from "vitest";
import {
  nameWithPhysicalPackage,
  resolveReceiptPackage,
} from "@/lib/receiptPackageResolver";

describe("receipt package resolver", () => {
  it("resolves common truncated fiscal package names", () => {
    const cases = [
      ["AMIDO MILHO KIMIMO 500", null, 500, "g"],
      ["BISC.MARILAN AMANT.280", null, 280, "g"],
      ["CAFE SOL.3 CORACOES 40", null, 40, "g"],
      ["LEITE COND. MOCA 395", null, 395, "g"],
      ["OLEO SOJA VILA VEL.900", null, 900, "ml"],
      ["QUIABO FERNAND.BAND300", null, 300, "g"],
      ["DESINF.SANOL LAVANDA 5", null, 5, "l"],
      ["LEITE FERM.YAKULT 6X80", null, 480, "ml"],
      ["IOG.DANONE POLPA 1,25k", null, 1.25, "kg"],
      ["MASSA PASTEL DA FEIRA", null, 1, "kg"],
      ["MILHO VD.FERN.BD.00G", null, 600, "g"],
    ] as const;

    for (const [name, saleUnit, quantity, unit] of cases) {
      const resolved = resolveReceiptPackage(name, saleUnit);
      expect(resolved?.pkg.quantity, name).toBeCloseTo(quantity, 4);
      expect(resolved?.pkg.unit, name).toBe(unit);
      expect(resolved?.confidence, name).toBe("high");
    }
  });

  it("keeps explicit packages and weighed goods reliable", () => {
    expect(resolveReceiptPackage("ACUCAR ST.ISABEL 1kg")?.pkg.unit).toBe("kg");
    expect(resolveReceiptPackage("LAVA LOUCA YPE 6X500ML")?.pkg.quantity).toBe(3000);
    expect(resolveReceiptPackage("COXAO DURO BOV.kg")?.pkg.quantity).toBe(1);
    expect(resolveReceiptPackage("ABACAXI UN")?.pkg.unit).toBe("un");
  });

  it("never treats container capacity or obvious codes as physical package", () => {
    expect(resolveReceiptPackage("SC LIXO ECOLIX 100L")).toBeNull();
    expect(resolveReceiptPackage("BALDE PLASTICO 12L")).toBeNull();
    expect(resolveReceiptPackage("FILME PVC FACILITA 28")).toBeNull();
    expect(resolveReceiptPackage("ELAST RICCA CO SM 15")).toBeNull();
    expect(resolveReceiptPackage("AMIDO MILHO KIMIMO COD 500")).toBeNull();
    expect(resolveReceiptPackage("AMIDO MILHO KIMIMO SKU 500")).toBeNull();
  });

  it("uses the fiscal sale unit as an honest fallback", () => {
    const each = resolveReceiptPackage("BISC OREO ORIGINAL", "UN");
    expect(each?.pkg.quantity).toBe(1);
    expect(each?.pkg.unit).toBe("un");
    expect(each?.confidence).toBe("fallback");

    const weighed = resolveReceiptPackage("CARNE MOIDA BOV RESF", "KG");
    expect(weighed?.pkg.quantity).toBe(1);
    expect(weighed?.pkg.unit).toBe("kg");
    expect(weighed?.confidence).toBe("high");
  });

  it("adds physical package units to display names without duplicating the number", () => {
    expect(nameWithPhysicalPackage("AMIDO MILHO KIMIMO 500", 500, "g"))
      .toBe("AMIDO MILHO KIMIMO 500g");
    expect(nameWithPhysicalPackage("OLEO SOJA VILA VEL.900", 900, "ml"))
      .toBe("OLEO SOJA VILA VEL.900ml");
    expect(nameWithPhysicalPackage("LEITE FERM.YAKULT 6X80", 480, "ml"))
      .toBe("LEITE FERM.YAKULT 6X80ml");
    expect(nameWithPhysicalPackage("MASSA PASTEL DA FEIRA", 1, "kg"))
      .toBe("MASSA PASTEL DA FEIRA 1kg");
    expect(nameWithPhysicalPackage("ABACAXI UN", 1, "un"))
      .toBe("ABACAXI UN");
  });
});
