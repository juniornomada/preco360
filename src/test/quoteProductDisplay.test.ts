import { describe, expect, it } from "vitest";
import { unitPriceForProduct } from "@/lib/productUnitPricing";
import { readableQuoteProductName } from "@/lib/quoteNamePresentation";
import {
  isPastryRollWithoutPhoto,
  withVerifiedQuotePackage,
} from "@/lib/quoteProductDisplay";

const daFeira = {
  id: "f05ca0d7-06b1-488e-bc36-0c6fdc45b283",
  name: "MASSA PASTEL DA FEIRA",
  package_size: null,
  unit: null,
};

describe("Cotar Beta exact pastry roll presentation", () => {
  it("fills the user-confirmed 1 kg package in the display only", () => {
    const display = withVerifiedQuotePackage(daFeira);
    expect(display.package_size).toBe(1);
    expect(display.unit).toBe("kg");
    expect(daFeira.package_size).toBeNull();
    expect(daFeira.unit).toBeNull();
    expect(unitPriceForProduct(display.name, display.package_size, display.unit, 33.55)?.normalizedPrice)
      .toBeCloseTo(33.55, 2);
    expect(readableQuoteProductName(display.name)).toContain("Massa para pastel");
  });

  it("does not infer any package if the product identity or name is different", () => {
    expect(withVerifiedQuotePackage({ ...daFeira, id: "other-id" })).toEqual({ ...daFeira, id: "other-id" });
    expect(withVerifiedQuotePackage({ ...daFeira, name: "MASSA PASTEL OUTRA MARCA" }).unit).toBeNull();
    expect(withVerifiedQuotePackage({ ...daFeira, package_size: 500, unit: "g" }).package_size).toBe(500);
    expect(withVerifiedQuotePackage({ ...daFeira, package_size: 500, unit: null }).unit).toBeNull();
  });

  it("never presents raw pastry roll dough as a plated pasta image", () => {
    expect(isPastryRollWithoutPhoto("Massa para pastel São Judas 500G", null)).toBe(true);
    expect(isPastryRollWithoutPhoto("Massa para pastel DA FEIRA", null)).toBe(true);
    expect(isPastryRollWithoutPhoto("Massa de modelar Play-Doh 2un", null)).toBe(false);
    expect(isPastryRollWithoutPhoto("Massa para pastel São Judas 500G", "https://example.test/photo.jpg"))
      .toBe(false);
  });
});
