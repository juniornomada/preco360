import { describe, expect, it } from "vitest";
import { genericBasketFamilies, genericBasketFamily } from "@/lib/flyerAnalysis";

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

  it("separates creme de leite tradicional from nata/fresco", () => {
    expect(genericBasketFamily("Creme de Leite Piracanjuba 200g")?.key).toBe(
      "leite:creme",
    );
    expect(
      genericBasketFamily("Creme de Leite Nata Promissão 300g")?.key,
    ).toBe("leite:creme-nata");
    expect(
      genericBasketFamily("Creme de Leite Fresco Fazenda 500g")?.key,
    ).toBe("leite:creme-nata");
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

  it("keeps non-macaroni dough and instant noodles out of the generic Macarrão family", () => {
    expect(
      genericBasketFamily(
        "Massa Fresca da Feira para Pastel rolo Massa da Feira 1kg",
      ),
    ).toBeNull();
    expect(
      genericBasketFamily(
        "Massa para Mini Pizza Massa da Feira pacote com 15 discos 450g",
      ),
    ).toBeNull();
    expect(
      genericBasketFamily("Massa para Lasanha Adria Sêmola 500g"),
    ).toBeNull();
    expect(
      genericBasketFamily("Macarrão Instantâneo Lámen Nissin 85g"),
    ).toBeNull();
    expect(genericBasketFamily("Macarrão Barilla 500g")?.key).toBe(
      "mercearia:macarrao",
    );
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
    expect(genericBasketFamily("Azeite Extra Virgem Gallo 500ml")?.key).toBe(
      "mercearia:azeite",
    );
    expect(
      genericBasketFamily("Papel Higiênico Personal VIP Folha Dupla 12un")?.key,
    ).toBe("higiene:papel-higienico");
  });

  it("groups powdered chocolate while keeping Nescau as an optional brand need", () => {
    const nescau = genericBasketFamilies(
      "Achocolatado Instantâneo em Pó Nescau Pacote 730g",
    );
    expect(nescau.map((family) => family.key)).toEqual([
      "mercearia:achocolatado-po",
      "marca:nescau-achocolatado-po",
    ]);

    expect(
      genericBasketFamilies("Achocolatado em Pó Toddy Pacote 1,8kg").map(
        (family) => family.key,
      ),
    ).toEqual(["mercearia:achocolatado-po"]);

    expect(
      genericBasketFamily("Bebida Láctea Achocolatado Nescau 180ml"),
    ).toBeNull();
    expect(genericBasketFamily("Cereal Nestlé Nescau 210g")).toBeNull();
  });

  it("keeps household basket categories broad without accepting unrelated products", () => {
    expect(
      genericBasketFamilies("Feijão Carioca Solito 1kg").map(
        (family) => family.key,
      ),
    ).toContain("graos:feijao");
    expect(
      genericBasketFamilies("Açúcar Demerara Orgânico Native 1kg").map(
        (family) => family.key,
      ),
    ).toContain("mercearia:acucar");

    expect(
      genericBasketFamily("Lava Roupas em Pó Brilhante 1,6kg")?.key,
    ).toBe("limpeza:sabao-po");
    expect(
      genericBasketFamily("Papel Toalha Interfolhado Fiel 1000un"),
    ).toBeNull();
    expect(genericBasketFamily("Papel Toalha Snob 2un")?.key).toBe(
      "limpeza:papel-toalha",
    );
  });

  it("separates common disinfectant from alcohol-based disinfectant", () => {
    expect(genericBasketFamily("Desinfetante Urca 2L")?.key).toBe(
      "limpeza:desinfetante",
    );
    expect(
      genericBasketFamily("Desinfetante Álcool Líquido Coperalcool 1L")?.key,
    ).toBe("limpeza:alcool");
    expect(genericBasketFamily("Álcool Líquido Coperalcool 1L")?.key).toBe(
      "limpeza:alcool",
    );
  });

  it("adds common hygiene and cleaning needs", () => {
    expect(genericBasketFamily("Papel Toalha Kitchen 2un")?.key).toBe(
      "limpeza:papel-toalha",
    );
    expect(genericBasketFamily("Creme Dental Colgate 90g")?.key).toBe(
      "higiene:creme-dental",
    );
    expect(genericBasketFamily("Sabão em Pó Omo 1,6kg")?.key).toBe(
      "limpeza:sabao-po",
    );
    expect(genericBasketFamily("Sabonete Líquido Protex 250ml")?.key).toBe(
      "higiene:sabonete-liquido",
    );
  });
});
