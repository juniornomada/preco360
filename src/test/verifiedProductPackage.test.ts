import { describe, expect, it } from "vitest";
import { hasVerifiedFiscalSaleWeight, verifiedPackageFromInput } from "@/lib/verifiedProductPackage";
import { unitPackageFromProduct, unitPriceForProduct } from "@/lib/productUnitPricing";

describe("receipt package sizes confirmed by owner", () => {
  it("accepts explicitly entered sizes in grams, kilograms, ml and litres", () => {
    expect(verifiedPackageFromInput("500", "g")).toEqual({ package_size: 500, unit: "g" });
    expect(verifiedPackageFromInput("1,25", "kg")).toEqual({ package_size: 1.25, unit: "kg" });
    expect(verifiedPackageFromInput("900", "ml")).toEqual({ package_size: 900, unit: "ml" });
    expect(verifiedPackageFromInput("1.5", "l")).toEqual({ package_size: 1.5, unit: "l" });
  });

  it("rejects invalid or unreliable quantities without guessing", () => {
    for (const raw of ["", "?", "3 unidades", "-1", "0", "5,00,0", "1e3", "200000"]) {
      expect(verifiedPackageFromInput(raw, "g")).toBeNull();
    }
    expect(verifiedPackageFromInput("500", "")).toBeNull();
    expect(verifiedPackageFromInput("500", "UN")).toBeNull();
  });

  it("distinguishes 3 units purchased from 60g in each pack", () => {
    const confirmed = verifiedPackageFromInput("60", "g");
    expect(confirmed).not.toBeNull();
    const amount = unitPriceForProduct("SALG TORCIDA", confirmed!.package_size, confirmed!.unit, 2.15);
    expect(amount?.normalizedPrice).toBeCloseTo(2.15 / 0.06, 2);
  });

  it("does not fabricate size from ambiguous truncated names", () => {
    expect(unitPackageFromProduct("LEITE F YAKULT", null, null)).toBeNull();
    expect(unitPackageFromProduct("LEITE FERM YAKULT 6X80", null, null)).toBeNull();
    expect(unitPackageFromProduct("MASSA PASTEL DA FEIRA", null, null)).toBeNull();
  });

  it("keeps explicit text units and weighed goods reliable", () => {
    expect(unitPriceForProduct("MASSA P/PASTEL SAO JUDAS 500G", null, null, 7.44)?.normalizedPrice)
      .toBeCloseTo(14.88, 2);
    expect(unitPriceForProduct("BATATA MONALISA KG", 1, "kg", 2.95)?.normalizedPrice)
      .toBeCloseTo(2.95, 2);
    expect(hasVerifiedFiscalSaleWeight("KG")).toBe(true);
    expect(hasVerifiedFiscalSaleWeight("UN")).toBe(false);
  });

  it("does not convert product capacity to liquid price", () => {
    expect(unitPriceForProduct("SC LIXO ECOLIX 100L", null, null, 8.90)).toBeNull();
    expect(unitPriceForProduct("BALDE PLASTICO 12L", null, null, 7.5)).toBeNull();
    expect(unitPriceForProduct("LAVA LOUCA YPE 6X500ML", null, null, 18)?.normalizedPrice)
      .toBeCloseTo(6, 2);
  });
});
