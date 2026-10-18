import { describe, expect, it } from "vitest";
import {
  offerReferenceFamiliesCompatible, offerReferenceFamilyKey,
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
