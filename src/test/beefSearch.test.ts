import { describe, expect, it } from "vitest";
import { isBeefOfferText, isBroadBeefSearch } from "@/lib/beefSearch";

describe("bovine meat search semantics", () => {
  it("recognizes broad bovine meat queries", () => {
    expect(isBroadBeefSearch("carne bovina")).toBe(true);
    expect(isBroadBeefSearch("carne boi")).toBe(true);
    expect(isBroadBeefSearch("carne de boi")).toBe(true);
    expect(isBroadBeefSearch("boi")).toBe(true);
    expect(isBroadBeefSearch("bovina")).toBe(true);
    expect(isBroadBeefSearch("bovino")).toBe(true);

    expect(isBroadBeefSearch("carne")).toBe(false);
    expect(isBroadBeefSearch("patinho")).toBe(false);
    expect(isBroadBeefSearch("paleta bovina")).toBe(false);
  });

  it("recognizes fresh bovine cuts and ground beef", () => {
    [
      "Acém Fresco",
      "Miolo do Acém Fresco",
      "Patinho Bovino",
      "Carne Moída Bovina Resfriada Bandeja 500g",
      "Alcatra c/ Maminha",
      "Paleta Bovina Fresca",
      "Bife de Coxão Mole Bovino sem Osso Bandeja Kg",
      "Contra Filé Bovino Embalado Friboi",
      "Costela Bovina Fresca",
      "Ponta de Peito s/ Osso Fresca",
      "Lagarto Fresco",
    ].forEach((name) => expect(isBeefOfferText(name)).toBe(true));
  });

  it("excludes pork, poultry, processed foods and unrelated products", () => {
    [
      "Bisteca da Paleta Suína Kg",
      "Paleta Suína com Osso e Pele Fresca",
      "Filé Mignon Suíno Aurora Kg",
      "Costela Suína Aurora Salgada kg",
      "Hambúrguer Bovino Sadia na Brasa c/ Picanha 150g",
      "Hambúrguer Bovmeat Carne Bovina/Aves 2,016kg",
      "Desengordurante Mr. Músculo Cozinha Refil com 400ml",
      "Bacon Defumado Perdigão sem Costela Peça Kg",
    ].forEach((name) => expect(isBeefOfferText(name)).toBe(false));
  });
});
