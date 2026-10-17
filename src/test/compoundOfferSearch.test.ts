import { describe, expect, it } from "vitest";
import { isFishOfferText } from "@/lib/beefSearch";
import {
  fishOfferPreparation,
  isCoffeeCapsuleProduct,
  isCornDerivedProduct,
  isCornDerivedQuery,
  matchesFishPreparation,
  requestedFishPreparation,
} from "@/lib/compoundOfferSearch";

describe("compound seafood preparation search", () => {
  it("understands both general fish and strict preparation requests", () => {
    expect(requestedFishPreparation("peixe")).toBeNull();
    expect(requestedFishPreparation("peixe congelado")).toBe("frozen");
    expect(requestedFishPreparation("peixes congelados")).toBe("frozen");
    expect(requestedFishPreparation("peixe fresco")).toBe("fresh");
    expect(requestedFishPreparation("peixe resfriado")).toBe("fresh");
    expect(requestedFishPreparation("salmão congelado")).toBeNull();
  });

  const frozen = "Filé de Peixe Tilápia Copacol Congelado 800g";
  const chilled = "Filé de Salmão c/ Pele Resfriado";
  const mixed = "Postas de Salmão Resfriado / Congelado";
  const unspecified = "Peixe Tilápia em Postas Copacol 800g";

  it("never represents frozen or unknown fish as fresh fish", () => {
    expect(fishOfferPreparation(frozen)).toBe("frozen");
    expect(fishOfferPreparation(chilled)).toBe("fresh");
    expect(fishOfferPreparation(mixed)).toBe("mixed");
    expect(fishOfferPreparation(unspecified)).toBe("unknown");
    expect(matchesFishPreparation(frozen, "peixe fresco")).toBe(false);
    expect(matchesFishPreparation(chilled, "peixe fresco")).toBe(true);
    expect(matchesFishPreparation(frozen, "peixe congelado")).toBe(true);
    expect(matchesFishPreparation(chilled, "peixe congelado")).toBe(false);
    expect(matchesFishPreparation(unspecified, "peixe congelado")).toBe(false);
    expect(matchesFishPreparation(mixed, "peixe fresco")).toBe(false);
    expect(matchesFishPreparation(mixed, "peixe congelado")).toBe(false);
    expect(matchesFishPreparation(chilled, "peixe")).toBe(true);
  });

  it("recognizes plural postas de salmão without extending fish to prepared sushi", () => {
    expect(isFishOfferText(chilled)).toBe(true);
    expect(isFishOfferText(mixed)).toBe(true);
    expect(isFishOfferText("Peixe Tilápia em Postas Copacol 800g")).toBe(true);
    expect(isFishOfferText("Temaki de Salmão Cream Cheese")).toBe(false);
  });
});

describe("milho: generic search versus explicit preparations", () => {
  it("recognizes derivatives but not packages of corn kernels", () => {
    for (const title of [
      "Curau",
      "Pamonha doce",
      "Curau de Milho",
      "Suco de Milho",
      "Pão Tauste de Milho",
      "Flocão de Milho Maratá 500g",
      "Farinha de Milho 1kg",
      "Bolo de Milho",
    ]) expect(isCornDerivedProduct(title)).toBe(true);
    for (const title of [
      "Milho Verde Fernandes bandeja 600g",
      "Milho Verde Fugini Sachê 170g",
      "Milho Verde lata 170g",
      "Milho para Pipoca Yoki 400g",
    ]) expect(isCornDerivedProduct(title)).toBe(false);
  });

  it("uses derivative intent only when specifically requested", () => {
    expect(isCornDerivedQuery("milho")).toBe(false);
    expect(isCornDerivedQuery("milho em lata")).toBe(false);
    expect(isCornDerivedQuery("milho fresco")).toBe(false);
    expect(isCornDerivedQuery("suco de milho")).toBe(true);
    expect(isCornDerivedQuery("pamonha de milho")).toBe(true);
    expect(isCornDerivedQuery("cural de milho")).toBe(true);
  });
});

describe("café: capsule-only search", () => {
  it("categorizes capsule coffee regardless of word order", () => {
    expect(isCoffeeCapsuleProduct("Café em Cápsula Pilão 10un")).toBe(true);
    expect(isCoffeeCapsuleProduct("Cápsulas de Café Nespresso 10un")).toBe(true);
    expect(isCoffeeCapsuleProduct("Café Caboclo 500g")).toBe(false);
    expect(isCoffeeCapsuleProduct("Café 3 Corações Pct 500g")).toBe(false);
    expect(isCoffeeCapsuleProduct("Café Solúvel Nescafé 200g")).toBe(false);
    expect(isCoffeeCapsuleProduct("Cápsulas de Vitamina C")).toBe(false);
  });
});
