import { describe, expect, it } from "vitest";
import { applyPrintedReceiptDiscounts, type PrintedReceiptItem } from "@/lib/printedReceiptDiscounts";
import { normalizeProductSearchText, productMatchesSearch } from "@/lib/productSearch";

const printedItem: PrintedReceiptItem = {
  itemNumber: "020", name: "CAPP.3 CORACOES 200g",
  quantity: "1", unit: "UN", price: "17.90",
  unitPrice: "17.90", totalPrice: "17.90",
};

describe("printed receipt item discounts", () => {
  it("attaches the exact printed line Desconto Item:020 -1,00", () => {
    const result = applyPrintedReceiptDiscounts([printedItem], [
      { itemNumber: "020", amount: "1,00" },
    ]);
    expect(result.applied).toBe(1);
    expect(result.unresolved).toBe(0);
    expect(result.items[0]).toMatchObject({
      originalUnitPrice: "17.90",
      originalTotalPrice: "17.90",
      discountAmount: "1.00",
      totalPrice: "16.90",
      price: "16.90",
      unitPrice: "16.90",
    });
    expect(Number(result.items[0].price) / 0.2).toBeCloseTo(84.5, 2);
  });

  it("leaves unrelated products unchanged", () => {
    const other: PrintedReceiptItem = {
      itemNumber: "019", name: "FILE PEITO FGO.CONG.kg", quantity: "1.278",
      unit: "KG", price: "15.89", unitPrice: "15.89", totalPrice: "20.31",
    };
    const result = applyPrintedReceiptDiscounts([other, printedItem], [
      { itemNumber: "20", amount: "1.00" },
    ]);
    expect(result.items[0].price).toBe("15.89");
    expect(result.items[1].price).toBe("16.90");
  });

  it("never allocates a generic subtotal reduction to arbitrary items", () => {
    const result = applyPrintedReceiptDiscounts([printedItem], [
      { itemNumber: "", amount: "1.00" },
    ]);
    expect(result.applied).toBe(0);
    expect(result.unresolved).toBe(1);
    expect(result.items[0].price).toBe("17.90");
  });

  it("deduplicates the same discount appearing in overlapping image crops", () => {
    const result = applyPrintedReceiptDiscounts([printedItem], [
      { itemNumber: "20", amount: "1.00" },
      { itemNumber: "020", amount: "1,00" },
    ]);
    expect(result.applied).toBe(1);
    expect(result.items[0].totalPrice).toBe("16.90");
  });

  it("does not guess when item numbers are missing or ambiguous", () => {
    expect(applyPrintedReceiptDiscounts([{ ...printedItem, itemNumber: undefined }], [
      { itemNumber: "20", amount: "1.00" },
    ]).unresolved).toBe(1);
    const duplicated = applyPrintedReceiptDiscounts(
      [printedItem, { ...printedItem, name: "OUTRO PRODUTO" }],
      [{ itemNumber: "20", amount: "1.00" }],
    );
    expect(duplicated.applied).toBe(0);
    expect(duplicated.unresolved).toBe(1);
  });

  it("calculates a line discount per actual KG quantity", () => {
    const result = applyPrintedReceiptDiscounts(
      [{ itemNumber: "018", name: "FILE PEITO FGO.CONG.kg", quantity: "1.496",
        unit: "KG", price: "15.89", unitPrice: "15.89", totalPrice: "23.77" }],
      [{ itemNumber: "18", amount: "1.00" }],
    );
    expect(result.applied).toBe(1);
    expect(result.items[0].totalPrice).toBe("22.77");
    expect(Number(result.items[0].price)).toBeCloseTo(22.77/1.496, 5);
    expect(result.items[0].price).toMatch(/^\d+\.\d{6}$/);
  });

  it("rejects discounts greater than the original line value", () => {
    const result = applyPrintedReceiptDiscounts([printedItem], [
      { itemNumber: "20", amount: "18.00" },
    ]);
    expect(result.unresolved).toBe(1);
    expect(result.items[0].price).toBe("17.90");
  });
});

describe("cappuccino search variants", () => {
  for (const query of ["cappuccino", "cappucino", "capucino", "capuccino", "CAPP."]) {
    it("finds cappuccino using " + query, () => {
      expect(normalizeProductSearchText(query)).toBe("cappuccino");
      expect(productMatchesSearch("CAPP.3 CORACOES 200g", query)).toBe(true);
      expect(productMatchesSearch("Cappuccino Solúvel Clássico 3 Corações 200g", query)).toBe(true);
      expect(productMatchesSearch("CAFÉ SOLÚVEL TRADICIONAL 200g", query)).toBe(false);
    });
  }
});
