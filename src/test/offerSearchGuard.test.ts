import { describe, expect, it } from "vitest";
import {
  isGenericSaltSearch,
  isGenericSugarSearch,
  isSaltProductName,
  isSugarProductName,
} from "@/lib/offerSearchGuard";

describe("offer search guards", () => {
  it("recognizes a generic sugar search", () => {
    expect(isGenericSugarSearch("açúcar")).toBe(true);
    expect(isGenericSugarSearch("AÇÚCAR")).toBe(true);
  });

  it("keeps more specific sugar searches literal", () => {
    expect(isGenericSugarSearch("açúcar cristal")).toBe(false);
    expect(isGenericSugarSearch("açúcar mascavo")).toBe(false);
  });

  it("accepts sugar as the product head", () => {
    expect(isSugarProductName("Açúcar Cristal Santa Isabel 1kg")).toBe(true);
    expect(isSugarProductName("Açúcar Demerara 1kg")).toBe(true);
  });

  it("rejects products where sugar is only an attribute", () => {
    expect(
      isSugarProductName("Refrigerante Coca-Cola Original/Sem Açúcar 200ml"),
    ).toBe(false);
    expect(isSugarProductName("Biscoito sem açúcar 120g")).toBe(false);
  });

  it("treats plain sal as a product search", () => {
    expect(isGenericSaltSearch("sal")).toBe(true);
    expect(isGenericSaltSearch("sal refinado")).toBe(false);
    expect(isSaltProductName("Sal Cisne Refinado Extra 1kg")).toBe(true);
    expect(isSaltProductName("Manteiga com Sal Lider Pote 200g")).toBe(false);
    expect(isSaltProductName("Salame Ceratti Italiano 100g")).toBe(false);
  });
});
