import { describe, expect, it } from "vitest";
import { genericBasketFamily } from "@/lib/flyerAnalysis";

describe("generic basket families", () => {
  it("groups brands of the same need together", () => {
    expect(genericBasketFamily("Leite em Pó Ninho Tipos Pacote 975g")).toEqual({
      key: "leite:po",
      label: "Leite em pó",
    });
    expect(
      genericBasketFamily("Leite em Pó Integral Instantâneo Glória Pacote 360g"),
    ).toEqual({
      key: "leite:po",
      label: "Leite em pó",
    });
  });

  it("keeps dairy and tomato derivatives separate", () => {
    expect(genericBasketFamily("Creme de Leite Piracanjuba 200g")?.key).toBe(
      "leite:creme",
    );
    expect(genericBasketFamily("Leite Longa Vida Terra Viva 1L")?.key).toBe(
      "leite:liquido",
    );
    expect(genericBasketFamily("Molho de Tomate Quero Tradicional 300g")?.key).toBe(
      "tomate:molho",
    );
    expect(genericBasketFamily("Sardinha ao Molho de Tomate 125g")).toBeNull();
  });

  it("supports common pantry needs without depending on brand", () => {
    expect(genericBasketFamily("Farinha de Trigo Tradicional Renata 1kg")).toEqual({
      key: "farinha:trigo",
      label: "Farinha de trigo",
    });
    expect(genericBasketFamily("Feijão Carioca Camil 1kg")?.key).toBe(
      "graos:feijao-carioca",
    );
    expect(genericBasketFamily("Óleo de Soja Liza 900ml")?.key).toBe(
      "mercearia:oleo-soja",
    );
  });
});
