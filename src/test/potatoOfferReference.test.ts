import { describe, expect, it } from "vitest";
import {
  offerReferenceFamiliesCompatible, offerReferenceFamilyKey,
  matchFlyerItem, inferPackage, normalizeSearchText,
} from "@/lib/flyerAnalysis";

describe("potato historical reference isolation", () => {
  it("separates fresh varieties, frozen fries, palha and potato snacks", () => {
    const names = [
      "Batata baroa 1kg",
      "Batata inglesa 1kg",
      "Batata doce 1kg",
      "Batata palito Rap Newbraz 2kg",
      "Batata palha Yoki 100g",
      "Batata Ruffles 68g",
    ];
    const keys = names.map(offerReferenceFamilyKey);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(names.length);
    for (let a = 0; a < names.length; a++) {
      for (let b = a + 1; b < names.length; b++) {
        expect(offerReferenceFamiliesCompatible(names[a], names[b])).toBe(false);
      }
    }
  });

  it("allows equivalent products from different brands when type is explicit", () => {
    expect(offerReferenceFamiliesCompatible(
      "Batata palha Bulnez 800g", "Batata palha Yoki 100g",
    )).toBe(true);
    expect(offerReferenceFamiliesCompatible(
      "Batata pré-frita McCain congelada 2kg", "Batata palito Newbraz 2kg",
    )).toBe(true);
  });

  it("does not guess when the imported name hides subtype", () => {
    expect(offerReferenceFamiliesCompatible(
      "Batata Uni 130g", "Batata palha Yoki 100g",
    )).toBe(false);
    expect(offerReferenceFamiliesCompatible(
      "Batata Uni 130g", "Batata Uni 130g",
    )).toBe(false);
    expect(offerReferenceFamiliesCompatible(
      "Pão de batata", "Batata inglesa",
    )).toBe(false);
  });
});

describe("safe imported potato catalog matching", () => {
  const candidate = (name: string) => ({
    rawName: name, price: 9.99, packageInfo: inferPackage(name),
    normalizedPrice: 9.99, baseUnit: "kg" as const,
    clubPrice: false, sourcePage: 1,
  });
  const products = [
    { id: "palha", name: "Batata Palha UNI 100G" },
    { id: "unknown", name: "BATATA UNI 130G" },
    { id: "baroa", name: "Batata Baroa 1kg" },
    { id: "inglesa", name: "Batata Inglesa 1kg" },
  ];
  it("blocks a bad stored alias from falsely linking unknown batata to palha", () => {
    const result = matchFlyerItem(candidate("Batata Uni 130g"), products.filter(p=>p.id!=="unknown"), [
      { product_id: "palha", normalized_alias: normalizeSearchText("Batata Uni 130g") },
    ]);
    expect(result.productId).toBeNull();
  });
  it("accepts only an exact unknown-subtype catalog name", () => {
    const result = matchFlyerItem(candidate("Batata Uni 130g"), products, []);
    expect(result.productId).toBe("unknown");
  });
  it("will not match a known fresh type to a different fresh type", () => {
    const result = matchFlyerItem(candidate("Batata Baroa 1kg"), [products[3]], []);
    expect(result.productId).toBeNull();
  });
});
