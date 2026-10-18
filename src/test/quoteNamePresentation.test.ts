import { describe, expect, it } from "vitest";
import { readableQuoteProductName } from "@/lib/quoteNamePresentation";

describe("Cotar complete product titles", () => {
  it("expands pastry dough NFC-e abbreviations without stripping the package", () => {
    expect(readableQuoteProductName("MASSA P/PASTEL SAO JUDAS 500G"))
      .toBe("Massa para pastel São Judas 500G");
  });
  it("keeps brand and quantity within the displayed name", () => {
    expect(readableQuoteProductName("MASSA PASTEL DA FEIRA 1KG"))
      .toBe("Massa para pastel DA FEIRA 1KG");
    expect(readableQuoteProductName("PAO QJO MASSALEV 1KG"))
      .toBe("Pão de queijo Massaleve 1KG");
  });
  it("does not change unrelated product names", () => {
    expect(readableQuoteProductName("Massa de modelar Play-Doh 2un"))
      .toBe("Massa de modelar Play-Doh 2un");
  });
});
