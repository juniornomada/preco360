import { describe, it, expect } from "vitest";
import { displayCatalogCategory } from "@/lib/catalogCategoryPresentation";

describe("catalog classification presentation", () => {
  it("shows known distinct potato categories without changing saved data", () => {
    expect(displayCatalogCategory("Batata palha Yoki 100g", "Geral")).toBe("Batata palha");
    expect(displayCatalogCategory("Batata baroa kg", "Geral")).toBe("Batata-baroa / mandioquinha");
    expect(displayCatalogCategory("Batata UNI 130g", "Geral")).toBe("Geral");
  });
  it("recognizes fiscal shorthand for pastry and cheese bread", () => {
    expect(displayCatalogCategory("MASSA P/PASTEL SAO JUDAS 500G", "Geral")).toBe("Massa para pastel");
    expect(displayCatalogCategory("PAO QJO MASSALEV 1KG", "Geral")).toBe("Pão de queijo");
  });
  it("respects existing custom category and keeps vague categories unverified", () => {
    expect(displayCatalogCategory("Batata palha Yoki", "Minhas compras")).toBe("Minhas compras");
    expect(displayCatalogCategory("MILHO VD.FERN.BD.00G", "Geral")).toBe("Geral");
  });
});
