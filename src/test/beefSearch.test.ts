import { describe, expect, it } from "vitest";
import {
  isBeefOfferText,
  isBroadBeefSearch,
  isBroadFishSearch,
  isBroadPorkSearch,
  isFishOfferText,
  isPorkOfferText,
} from "@/lib/beefSearch";

describe("animal protein search semantics", () => {
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

  it("recognizes broad pork queries", () => {
    expect(isBroadPorkSearch("carne suína")).toBe(true);
    expect(isBroadPorkSearch("carne suina")).toBe(true);
    expect(isBroadPorkSearch("carne de porco")).toBe(true);
    expect(isBroadPorkSearch("porco")).toBe(true);
    expect(isBroadPorkSearch("suíno")).toBe(true);
    expect(isBroadPorkSearch("suina")).toBe(true);

    expect(isBroadPorkSearch("carne")).toBe(false);
    expect(isBroadPorkSearch("pernil")).toBe(false);
    expect(isBroadPorkSearch("paleta suína")).toBe(false);
  });

  it("recognizes broad fish queries", () => {
    expect(isBroadFishSearch("peixe")).toBe(true);
    expect(isBroadFishSearch("peixes")).toBe(true);
    expect(isBroadFishSearch("pescado")).toBe(true);
    expect(isBroadFishSearch("pescados")).toBe(true);

    expect(isBroadFishSearch("tilápia")).toBe(false);
    expect(isBroadFishSearch("filé de peixe")).toBe(false);
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

  it("recognizes pork cuts and excludes processed or non-pork items", () => {
    [
      "Bisteca da Paleta Suína Kg",
      "Bisteca Suína Congelada Aurora Kg",
      "Filé Mignon Suíno Aurora Kg",
      "Costela Suína Aurora Salgada kg",
      "Lombo Seara Levíssimo peça/ fatiado/ pedaço/ kg",
      "Lombo Suíno Frimesa Congelado",
      "Paleta Suína c/ Osso e Pele Fresca",
      "Panceta Suína Temperada Pacote Kg",
      "Pernil Suíno c/ Couro e Osso Kg",
      "Orelha Suína com Cara Salgada kg",
      "Pé Suíno Salgado kg",
      "Pele Suína Salgada kg",
      "Rabo Suíno Salgado kg",
    ].forEach((name) => expect(isPorkOfferText(name)).toBe(true));

    [
      "Paleta Bovina Fresca",
      "Costela Bovina Fresca",
      "Linguiça de Carne Suína Seara Congelada 5kg",
      "Linguiça de Pernil Kg",
      "Bacon Defumado Perdigão sem Costela Peça Kg",
      "Jerked Suino Pacote",
      "Costelinha de Pacu/Tambaqui Resfriado",
      "Bisteca do Contra Kg",
    ].forEach((name) => expect(isPorkOfferText(name)).toBe(false));
  });

  it("recognizes fish products and excludes dishes or unrelated text", () => {
    [
      "Filé de Linguado Frumar Congelado 800g",
      "Filé de Merluza Argentino Congelado Mar & Rio Pacote 800g",
      "Filé de Peixe Tilápia Copacol Congelado 800g",
      "Filé de Tilápia Premium",
      "Filé Panga Costa Sul Congelado Pacote 500g",
      "Posta de Tilápia Congelada Copacol Pacote 800g",
      "Costelinha de Pacu/Tambaqui Resfriado",
      "Atum Coqueiro Sólido 120g",
      "Sardinha Palmeira Tipos 125g",
    ].forEach((name) => expect(isFishOfferText(name)).toBe(true));

    [
      "Temaki de Salmão com Cream Cheese Confiança 100g",
      "Temaki Salmão Cream Cheese",
      "Farinha de Milho Flocão Dona Clara 500g",
      "Shampoo e Condicionador Procão 1L",
      "Massa de Pastel Massaleve Discão Pacote 500g",
    ].forEach((name) => expect(isFishOfferText(name)).toBe(false));
  });

  it("keeps beef exclusions intact", () => {
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
