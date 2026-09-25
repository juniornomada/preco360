import { describe, expect, it } from "vitest";
import { productMatchesSearch } from "@/lib/productSearch";

describe("productMatchesSearch", () => {
  it("does not match leite against an unrelated 5 L product", () => {
    expect(
      productMatchesSearch(
        "Água Sanitária Qboa 5 L Max Atacadista",
        "leite",
      ),
    ).toBe(false);
  });

  it("matches actual milk products", () => {
    expect(
      productMatchesSearch(
        "Leite Integral Italac 1 L",
        "leite",
      ),
    ).toBe(true);
  });

  it("keeps desinfetante restricted to the product family", () => {
    expect(
      productMatchesSearch(
        "Desinfetante Uau Lavanda 2 L",
        "desinfetante",
      ),
    ).toBe(true);

    expect(
      productMatchesSearch(
        "Bebida de Uva Adoçada Precioso 1,5 L",
        "desinfetante",
      ),
    ).toBe(false);
  });

  it("keeps multi-word searches strict", () => {
    expect(
      productMatchesSearch(
        "Molho de Tomate Fugini 300 g",
        "molho de tomate",
      ),
    ).toBe(true);

    expect(
      productMatchesSearch(
        "Tomate Italiano kg",
        "molho de tomate",
      ),
    ).toBe(false);
  });
});
