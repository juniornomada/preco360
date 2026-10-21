import { describe, expect, it } from "vitest";
import {
  isPastryRollWithoutPhoto,
  withVerifiedQuotePackage,
} from "@/lib/quoteProductDisplay";

describe("Cotar package presentation", () => {
  it("uses persisted package metadata without display-only overrides", () => {
    const persisted = {
      id: "f05ca0d7-06b1-488e-bc36-0c6fdc45b283",
      name: "MASSA PASTEL DA FEIRA 1kg",
      package_size: 1,
      unit: "kg",
    };
    expect(withVerifiedQuotePackage(persisted)).toEqual(persisted);

    const unresolved = {
      ...persisted,
      name: "OUTRO PRODUTO",
      package_size: null,
      unit: null,
    };
    expect(withVerifiedQuotePackage(unresolved)).toEqual(unresolved);
  });

  it("never presents raw pastry roll dough as a plated pasta image", () => {
    expect(isPastryRollWithoutPhoto("Massa para pastel São Judas 500G", null)).toBe(true);
    expect(isPastryRollWithoutPhoto("Massa para pastel DA FEIRA", null)).toBe(true);
    expect(isPastryRollWithoutPhoto("Massa de modelar Play-Doh 2un", null)).toBe(false);
    expect(isPastryRollWithoutPhoto("Massa para pastel São Judas 500G", "https://example.test/photo.jpg"))
      .toBe(false);
  });
});
