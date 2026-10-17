import {describe,it,expect} from "vitest";
import {chickenKind,chickenQueryIntent,chickenComparableKey,meatPreparation,
  requestedChickenPreparation} from "@/lib/chickenOfferKinds";

describe("comparable chicken cuts and preparations",()=>{
  it("does not confuse a whole bird with fillets or breast",()=>{
    expect(chickenKind("Frango Inteiro Congelado")).toBe("chickenWhole");
    expect(chickenKind("Filé de Peito de Frango congelado")).toBe("chickenBreastFillet");
    expect(chickenKind("Filézinho de Frango Sadia Congelado")).toBe("chickenTenderloin");
    expect(chickenKind("Peito de Frango com osso")).toBe("chickenBreastBone");
    expect(chickenKind("Peito de Frango sem osso")).toBe("chickenBreastBoneless");
    expect(chickenKind("Peito de Frango Seara desfiado")).toBe("chickenShredded");
    expect(chickenKind("Sobrecoxa de Frango Seara Bandeja")).toBe("chickenThigh");
    expect(chickenKind("Coxa de Frango Sadia IQF Congelada")).toBe("chickenDrumstick");
    expect(chickenKind("Frango assado Confiança")).toBe("chickenRoasted");
    expect(chickenKind("Purê de Batata Doce com Frango Desfiado Swift Pro&Fit Prato Feito 300g"))
      .toBe("chickenMeal");
    expect(chickenKind("Peito de Frango Desfiado Seara 400g")).toBe("chickenShredded");
    expect(chickenComparableKey("Purê de Batata Doce com Frango Desfiado Swift Pro&Fit"))
      .not.toBe(chickenComparableKey("Peito de Frango Desfiado Seara 400g"));
    expect(chickenKind("Peito de peru defumado")).toBeNull();
  });
  it("keeps historical benchmarks within cuts AND preparation",()=>{
    expect(chickenComparableKey("Frango Inteiro congelado"))
      .not.toBe(chickenComparableKey("Filé de peito de frango congelado"));
    expect(chickenComparableKey("Peito de Frango sem osso congelado"))
      .not.toBe(chickenComparableKey("Peito de Frango com osso congelado"));
    expect(chickenComparableKey("Coxa de frango fresca"))
      .not.toBe(chickenComparableKey("Coxa de frango congelada"));
    expect(meatPreparation("Frango Resfriado")).toBe("fresh");
    expect(requestedChickenPreparation("frango congelado")).toBe("frozen");
    expect(requestedChickenPreparation("frango")).toBeNull();
  });
  it("understands broad versus specific requests",()=>{
    expect(chickenQueryIntent("frango")).toBe("chicken");
    expect(chickenQueryIntent("frango congelado")).toBe("chicken");
    expect(chickenQueryIntent("frango inteiro")).toBe("chickenWhole");
    expect(chickenQueryIntent("filé de peito de frango congelado")).toBe("chickenBreastFillet");
    expect(chickenQueryIntent("frango desfiado")).toBe("chickenShredded");
  });
});