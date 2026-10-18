import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PriceQuoteSearchResult from "@/components/PriceQuoteSearchResult";

const renderRow = (props: Partial<Parameters<typeof PriceQuoteSearchResult>[0]> = {}) =>
  renderToStaticMarkup(createElement(PriceQuoteSearchResult, {
    name: "MASSA PARA PASTEL SÃO JUDAS 500G",
    category: "Massas",
    price: "R$ 7,44",
    normalizedPrice: "R$ 14,88/kg",
    historyCount: 1,
    date: "18/10/2026",
    onSelect: () => {},
    ...props,
  }));

describe("Cotar search result layout", () => {
  it("shows a complete one-line product name, normalized price, package price and history/date", () => {
    const html = renderRow();
    expect(html).toContain("MASSA PARA PASTEL SÃO JUDAS 500G");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("whitespace-nowrap");
    expect(html).not.toContain("text-ellipsis");
    expect(html).toContain("R$ 14,88/kg");
    expect(html).toContain("R$ 7,44");
    expect(html).toContain("1 preço no histórico");
    expect(html).toContain("18/10/2026");
    expect(html).not.toContain("Marca:");
  });

  it("handles per-litre prices and many past prices", () => {
    const html = renderRow({
      name: "LEITE INTEGRAL LONGA VIDA 1L",
      price: "R$ 5,99",
      normalizedPrice: "R$ 5,99/L",
      historyCount: 12,
    });
    expect(html).toContain("R$ 5,99/L");
    expect(html).toContain("12 preços no histórico");
  });

  it("doesn't invent a normalized value or a date for unknown packaging", () => {
    const html = renderRow({
      name: "BATATA UNI 130G",
      price: "Sem preço",
      normalizedPrice: null,
      historyCount: 0,
      date: null,
    });
    expect(html).toContain("Preço unitário indisponível");
    expect(html).toContain("Sem preços no histórico");
    expect(html).toContain("Sem data");
  });
});
