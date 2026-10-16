import { describe, expect, it } from "vitest";
import { productMatchesSearch, productSearchTokens, normalizeProductSearchText } from "@/lib/productSearch";

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


describe("Poncan search aliases", () => {
  it("canonicalizes common speech spellings to poncan", () => {
    const variants = ["poncã", "ponca", "poncan", "ponkan", "pocan", "pokan"];
    for (const variant of variants) {
      expect(productSearchTokens(variant)).toEqual(["poncan"]);
    }
  });
});

describe("fruit-name ASR aliases", () => {
  it("recognizes kaqui as caqui without misclassifying unrelated typed words", () => {
    expect(normalizeProductSearchText("Kaqui")).toBe("caqui");
    expect(productSearchTokens("kaki")).toEqual(["caqui"]);
    expect(productMatchesSearch("Caqui Fruta 1kg", "kaqui")).toBe(true);
    expect(normalizeProductSearchText("Cacique")).toBe("cacique");
  });
});

describe("Murcott fruit aliases and unrelated short abbreviations", () => {
  it("finds historic Murcote/Morgote without matching the unrelated Activia MOR", () => {
    for (const variant of ["moricote", "morgote", "murcote", "murcott", "morcote"]) {
      expect(productSearchTokens(variant)).toEqual(["murcote"]);
      expect(productMatchesSearch("MURCOTE", variant)).toBe(true);
      expect(productMatchesSearch("TANGERINA MORGOTE kg", variant)).toBe(true);
      expect(productMatchesSearch("LEITE F ACTIVIA MOR", variant)).toBe(false);
    }
  });

  it("rejects a misleading three-character suffix of an unrelated product", () => {
    expect(productMatchesSearch("LEITE F ACTIVIA MOR", "moricote")).toBe(false);
    expect(productMatchesSearch("MORANGO", "moricote")).toBe(false);
    expect(productMatchesSearch("MILHO PIP YOKI", "milho")).toBe(true);
    expect(productMatchesSearch("BANANA NANICA", "banana maçã")).toBe(false);
    expect(productMatchesSearch("BANANA MAÇÃ", "banana maçã")).toBe(true);
    expect(productMatchesSearch("LEITE HERCULES INT.1L", "leite")).toBe(true);
  });
});
