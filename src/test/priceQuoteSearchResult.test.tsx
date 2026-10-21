import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PriceQuoteSearchResult from "@/components/PriceQuoteSearchResult";

const renderRow = (props: Partial<Parameters<typeof PriceQuoteSearchResult>[0]> = {}) =>
  renderToStaticMarkup(createElement(PriceQuoteSearchResult, {
    name: "MASSA PARA PASTEL SÃO JUDAS 500G",
    price: "R$ 7,44",
    normalizedPrice: "R$ 14,88/kg",
    historyCount: 1,
    date: "18/10/2026",
    onSelect: () => {},
    onHistory: () => {},
    ...props,
  }));

describe("Cotar data-first search result layout", () => {
  it("shows complete names above prices, with natural wrapping and no image/ellipsis", () => {
    const html = renderRow();
    expect(html).toContain("MASSA PARA PASTEL SÃO JUDAS 500G");
    expect(html).toContain("break-words");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("whitespace-nowrap");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("<img");
    expect(html).toContain("Referência por kg/L/un.");
    expect(html).toContain("Último preço");
    expect(html).toContain("R$ 14,88/kg");
    expect(html).toContain("R$ 7,44");
    expect(html).toContain("1 preço no histórico");
    expect(html).toContain("18/10/2026");
  });

  it("keeps quantities visible in titles and displays litre comparisons", () => {
    const html = renderRow({
      name: "LEITE INTEGRAL LONGA VIDA 1L",
      price: "R$ 5,99",
      normalizedPrice: "R$ 5,99/L",
      historyCount: 12,
    });
    expect(html).toContain("LEITE INTEGRAL LONGA VIDA 1L");
    expect(html).toContain("R$ 5,99/L");
    expect(html).toContain("12 preços no histórico");
  });

  it("exposes two separate accessible controls for quote and inline history", () => {
    const html = renderRow();
    expect((html.match(/<button\\b/g) ?? []).length).toBe(2);
    expect(html).toContain("Selecionar produto para cotar");
    expect(html).toContain("Ver histórico de preços de MASSA PARA PASTEL SÃO JUDAS 500G");
    expect(html).toContain("2.5");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("/product/");
  });

  it("does not offer a clickable history action if the product has no history", () => {
    const html = renderRow({ historyCount: 0 });
    expect((html.match(/<button\\b/g) ?? []).length).toBe(1);
    expect(html).toContain("Sem preços no histórico");
  });

  it("never invents a normalized price or date when data is unavailable", () => {
    const html = renderRow({
      name: "BATATA UNI 130G",
      price: "Sem preço",
      normalizedPrice: null,
      historyCount: 0,
      date: null,
    });
    expect(html).toContain("Sem referência");
    expect(html).toContain("Sem preços no histórico");
    expect(html).toContain("Sem data");
  });
});
