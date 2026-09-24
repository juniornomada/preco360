import { describe, expect, it } from "vitest";
import {
  forceProductVisual,
  productVisual,
} from "@/lib/productVisualResolver";

describe("product visual resolver", () => {
  it("prioritizes product type over flavor words", () => {
    expect(productVisual("Café sabor chocolate 250g")).toBe("☕");
    expect(productVisual("Barra de Proteína Cappuccino 3 Corações 50g")).toBe("__proteinbar__");
    expect(productVisual("Bebida Láctea Toddynho 200ml")).toBe("__toddynho__");
  });

  it("keeps visually close categories separate", () => {
    expect(productVisual("Papel Toalha Absoluto Multiuso 2un")).toBe("__papertowel__");
    expect(productVisual("Papel Higiênico Familiar Maciez 12un")).toBe("🧻");
    expect(productVisual("Uva Verde sem Semente 500g")).toBe("__greengrapes__");
    expect(productVisual("Uva Vitória 500g")).toBe("🍇");
    expect(productVisual("Abobrinha Paulista Verde Kg")).toBe("__zucchini_paulista__");
    expect(productVisual("Abobrinha Italiana")).toBe("__zucchini_italiana__");
    expect(productVisual("Abobrinha Verde Kg")).toBe("__zucchini__");
    expect(productVisual("Abóbora Cabotiá Kg")).toBe("🎃");
  });

  it("covers specific audited products", () => {
    expect(productVisual("Filé de Merluza Argentina congelado 1kg")).toBe("__fishfillet__");
    expect(productVisual("Feijão Carioca Famil 1kg")).toBe("🫘");
    expect(productVisual("Refrigerante Sukita 2000ml")).toBe("__soda__");
    expect(productVisual("Batata Doce Rosada")).toBe("__sweetpotato__");
    expect(productVisual("Cápsulas de Bebida Dolce Gusto")).toBe("__dolcegusto__");
    expect(productVisual("Farinha de Trigo Tradicional Renata 1kg")).toBe("__flourbag__");
    expect(productVisual("Ketchup Heinz 397g")).toBe("__ketchup__");
    expect(productVisual("Molho Barbecue Elefante 190g")).toBe("__bbq__");
    expect(productVisual("Molho de Tomate Quero Tradicional 240g")).toBe("__tomatosauce__");
    expect(productVisual("Sabonete Dove Original 90g")).toBe("__soapbar__");
    expect(productVisual("Sabonete Íntimo Protex Frasco 350ml")).toBe("🧴");
    expect(productVisual("Bacon em Fatias Seara Gourmet 250g")).toBe("__baconslices__");
    expect(productVisual("Jerked Beef Cubos Light Paineira 500g")).toBe("__jerkedbeef__");
    expect(productVisual("Mousse de Chocolate Confiança")).toBe("__mousse__");
  });

  it("forces safe icons only for high-risk families", () => {
    expect(forceProductVisual("Antisséptico Listerine Tipos 500ml")).toBe(true);
    expect(forceProductVisual("Cápsulas de Bebida Dolce Gusto")).toBe(true);
    expect(forceProductVisual("Filé de Merluza El Mare 500g")).toBe(false);
    expect(forceProductVisual("Filé de Merluza Seara Congelada 500g")).toBe(false);
    expect(forceProductVisual("Bisteca Suína Congelada Aurora Kg")).toBe(false);
    expect(forceProductVisual("Sabonete Dove Original 90g")).toBe(false);
    expect(forceProductVisual("Uva Verde sem Semente 500g")).toBe(true);
    expect(forceProductVisual("Abobrinha Paulista Verde Kg")).toBe(true);
    expect(forceProductVisual("Abobrinha Italiana")).toBe(true);
    expect(forceProductVisual("Batata Doce Kg")).toBe(false);
    expect(forceProductVisual("Batata Doce Rosada")).toBe(false);
    expect(forceProductVisual("Café em Pó Pilão 500g")).toBe(false);
  });
});
