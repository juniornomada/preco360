import { describe, expect, it } from "vitest";
import {
  isCannedFishOffer,
  packagePriceIsMeaningfullyDifferent,
  prioritizeKgPrice,
} from "@/lib/offerPriceDisplay";

describe("meat and fish price display", () => {
  it("prioritizes R$/kg for beef, pork and fresh/frozen fish", () => {
    expect(prioritizeKgPrice("beef", "Patinho Bovino", "kg")).toBe(true);
    expect(prioritizeKgPrice("pork", "Pernil Suíno", "kg")).toBe(true);
    expect(prioritizeKgPrice("fish", "Filé de Tilápia", "kg")).toBe(true);
    expect(prioritizeKgPrice("fish", "Sardinha Fresca Kg", "kg")).toBe(true);
    expect(prioritizeKgPrice("fish", "Atum Congelado 500g", "kg")).toBe(true);
  });

  it("recognizes canned tuna and sardines even when the flyer omits 'lata'", () => {
    [
      "Atum Coqueiro Sólido 120g",
      "Atum Natural Robinson Crusoe 140g",
      "Atum Robinson Crusoe Pedaço em Óleo 170g",
      "Sardinha Palmeira Tipos 125g",
      "Sardinha Gomes da Costa lata / tipos / 125g",
      "Atum 170g",
    ].forEach((name) => expect(isCannedFishOffer(name)).toBe(true));

    expect(isCannedFishOffer("Sardinha Fresca Kg")).toBe(false);
    expect(isCannedFishOffer("Atum Congelado 500g")).toBe(false);
    expect(isCannedFishOffer("Temaki Teika Atum 100g")).toBe(false);
  });

  it("keeps package price primary for canned tuna and sardines", () => {
    expect(prioritizeKgPrice("fish", "Atum Coqueiro Sólido 120g", "kg")).toBe(false);
    expect(prioritizeKgPrice("fish", "Sardinha Palmeira Tipos 125g", "kg")).toBe(false);
  });

  it("also prioritizes common fresh chicken cuts", () => {
    expect(prioritizeKgPrice("other", "Frango Inteiro", "kg")).toBe(true);
    expect(prioritizeKgPrice("other", "Sobrecoxa de Frango", "kg")).toBe(true);
    expect(prioritizeKgPrice("other", "Peito de Frango", "kg")).toBe(true);
  });

  it("does not alter non-weight or unrelated products", () => {
    expect(prioritizeKgPrice("beef", "Hambúrguer Bovino 2un", "un")).toBe(false);
    expect(prioritizeKgPrice("other", "Arroz 5kg", "kg")).toBe(false);
  });

  it("shows package total only when it differs from the kg price", () => {
    expect(packagePriceIsMeaningfullyDifferent(21.45, 42.9)).toBe(true);
    expect(packagePriceIsMeaningfullyDifferent(42.9, 42.9)).toBe(false);
  });
});
