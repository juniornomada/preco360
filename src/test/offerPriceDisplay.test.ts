import { describe, expect, it } from "vitest";
import {
  packagePriceIsMeaningfullyDifferent,
  prioritizeKgPrice,
} from "@/lib/offerPriceDisplay";

describe("meat price display", () => {
  it("prioritizes R$/kg for beef, pork and fish", () => {
    expect(prioritizeKgPrice("beef", "Patinho Bovino", "kg")).toBe(true);
    expect(prioritizeKgPrice("pork", "Pernil Suíno", "kg")).toBe(true);
    expect(prioritizeKgPrice("fish", "Filé de Tilápia", "kg")).toBe(true);
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
