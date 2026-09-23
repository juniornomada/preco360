import { describe, expect, it } from "vitest";
import {
  inferPackage,
  offerPackageInfo,
  offerReferenceFamiliesCompatible,
  offerReferenceFamilyKey,
  offerReferenceRequiresKnownCount,
} from "@/lib/flyerAnalysis";

describe("offer reference normalization", () => {
  it("keeps decimal package quantities intact", () => {
    expect(inferPackage("Limpador 1.8L")?.baseQuantity).toBeCloseTo(1.8);
    expect(inferPackage("Hambúrguer 2.016kg")?.baseQuantity).toBeCloseTo(2.016);
  });

  it("understands multipacks from names and notes", () => {
    expect(inferPackage("Leve Pague 3x90g")?.baseQuantity).toBeCloseTo(0.27);
    expect(inferPackage("Hambúrguer 56g Cada/Cx 12un")?.baseQuantity).toBeCloseTo(0.672);

    const beer = offerPackageInfo(
      "Cerveja Império Pilsen 350ml",
      350,
      "ml",
      ["Nesta embalagem a unidade sai por R$ 2,69"],
      40.35,
    );
    expect(beer?.baseUnit).toBe("l");
    expect(beer?.baseQuantity).toBeCloseTo(5.25);

    const toiletPaper = offerPackageInfo(
      "Papel Higiênico Neve Folha Dupla 720m",
      null,
      null,
      ["Pacote com 24 unidades"],
      39.9,
    );
    expect(toiletPaper?.baseUnit).toBe("un");
    expect(toiletPaper?.baseQuantity).toBe(24);
  });

  it("treats container capacity as a specification, not a price unit", () => {
    const organizer = offerPackageInfo(
      "Caixa Organizadora Plasvale 38L",
      38,
      "l",
      [],
      28.98,
    );
    expect(organizer?.baseUnit).toBe("un");
    expect(organizer?.baseQuantity).toBe(1);
  });

  it("blocks references across incompatible product families", () => {
    expect(
      offerReferenceFamiliesCompatible(
        "Alimento para Cães Coby 18kg",
        "Alimento para Gatos Qualidy Creminho 60g",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Toalha Umedecida Huggies Tripla Proteção 120un",
        "Fralda Huggies Tripla Proteção 32un",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Papel Toalha Interfolhado Fiel 1000un",
        "Papel Higiênico Neve Folha Dupla 12un",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Limpador Perfumado Uau 1,8L",
        "Limpador Perfumado Concentrado Secar 120ml",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Biscoito Marilan Maizena 300g",
        "Biscoito Marilan Wafer Chocolate 70g",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Batata Congelada McCain Air Fryer Extra Crocante 600g",
        "Batata Extra Kg",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Bebida Láctea Piracanjuba Whey 250ml",
        "Bebida Láctea Líder Chocolate 1L",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Amaciante Ypê Concentrado 500ml",
        "Amaciante Ypê Aconchego 2L",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Shampoo e Condicionador Procão 1L",
        "Shampoo Neutrox 300ml",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Gelatina Zero Açúcar Apti 12g",
        "Gelatina Apti Sabores 1kg",
      ),
    ).toBe(false);

    expect(
      offerReferenceFamiliesCompatible(
        "Bolo de Pote Tauste Prestígio 200g",
        "Bolo Tauste Abóbora com Coco 100g",
      ),
    ).toBe(false);
  });

  it("keeps compatible families comparable", () => {
    expect(
      offerReferenceFamiliesCompatible(
        "Alimento para Cães Coby 18kg",
        "Alimento para Cães Herói 15kg",
      ),
    ).toBe(true);

    expect(
      offerReferenceFamiliesCompatible(
        "Papel Higiênico Duetto Folha Dupla 16un",
        "Papel Higiênico Personal Folha Dupla 12un",
      ),
    ).toBe(true);

    const key = offerReferenceFamilyKey(
      "Papel Higiênico Duetto Folha Dupla 16un",
    );
    expect(offerReferenceRequiresKnownCount(key)).toBe(true);
  });
});
