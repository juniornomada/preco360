import { describe, expect, it } from "vitest";
import {
  bananaProductKind,
  isBananaFruitQuery,
  isFruitBananaProduct,
  isGenericMilkQuery,
  milkProductKind,
} from "@/lib/offerProductKinds";

describe("milk and banana product families", () => {
  it("distinguishes real receipt abbreviations from carton milk", () => {
    expect(milkProductKind("LEITE F YAKULT")).toBe("milkFermented");
    expect(milkProductKind("LEITE F YAKULT PESSE")).toBe("milkFermented");
    expect(milkProductKind("LEITE F ACTIVIA MOR")).toBe("milkFermented");
    expect(milkProductKind("LEITE FERM.FRUTAP 850g")).toBe("milkFermented");
    expect(milkProductKind("LEITE HERCULES INT.1L")).toBe("milkLiquid");
    expect(milkProductKind("LEITE FAZENDA B.VISTA")).toBe("milkLiquid");
    expect(milkProductKind("LEITE L. VIDA TERRA")).toBe("milkLiquid");
    expect(milkProductKind("LEITE PO NINHO INT.INS")).toBe("milkPowder");
    expect(milkProductKind("LEITE COND. MOCA 395")).toBe("milkCondensed");
  });

  it("reserves the fruit family for fresh bananas", () => {
    expect(isBananaFruitQuery("banana")).toBe(true);
    expect(isBananaFruitQuery("banana fruta")).toBe(true);
    expect(isBananaFruitQuery("banana chips")).toBe(false);
    expect(bananaProductKind("BANANA NANICA")).toBe("bananaFresh");
    expect(isFruitBananaProduct("Banana Prata 1kg")).toBe(true);
    expect(bananaProductKind("Barra de Fruta Nutry Banana com Chocolate/ Coco com Chocolate 20g")).toBe("bananaRelated");
    expect(bananaProductKind("Banana passa 100g")).toBe("bananaRelated");
  });

  it("identifies plain milk as a broad query, not fermented milk specifically", () => {
    expect(isGenericMilkQuery("Leite")).toBe(true);
    expect(isGenericMilkQuery("leite integral")).toBe(false);
    expect(isGenericMilkQuery("leite condensado")).toBe(false);
  });
});
