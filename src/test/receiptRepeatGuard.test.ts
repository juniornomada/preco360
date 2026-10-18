import { describe, it, expect } from "vitest";
import { currentLocalReceiptDate, possibleRecentReceiptDuplicate } from "@/lib/receiptRepeatGuard";

describe("printed fiscal receipt repeat protection", () => {
  const now = new Date("2026-10-18T02:05:00Z");
  const previous = [{
    supermarket:"CONFIANCA AQUARIUS",
    receipt_date:"2026-10-17",
    imported_at:"2026-10-17T22:12:01Z",
    original_line_count:24,
    saved_price_count:21,
  }];
  it("warns when the same 24-line basket returns with a supermarket alias and one-day date shift", () => {
    const match=possibleRecentReceiptDuplicate(previous, {
      supermarket:"SUPERMERCADOS CONFIANCA LTDA",receiptDate:"2026-10-18",
      originalLineCount:24,savedProductCount:20,
    },now);
    expect(match?.supermarket).toBe("CONFIANCA AQUARIUS");
  });
  it("warns for the other real photographed-receipt alias too",()=>{
    expect(possibleRecentReceiptDuplicate(previous, {
      supermarket:"CONFIANCA SUPERMERCADOS",receiptDate:"2026-10-18",
      originalLineCount:24,savedProductCount:20,
    },now)).not.toBeNull();
  });
  it("does not treat unrelated stores or significantly different baskets as duplicates",()=>{
    const base={receiptDate:"2026-10-18",originalLineCount:24,savedProductCount:20};
    expect(possibleRecentReceiptDuplicate(previous, {...base,supermarket:"Tauste"},now)).toBeNull();
    expect(possibleRecentReceiptDuplicate(previous, {...base,supermarket:"CONFIANCA",originalLineCount:12},now)).toBeNull();
    expect(possibleRecentReceiptDuplicate(previous, {...base,supermarket:"CONFIANCA",savedProductCount:9},now)).toBeNull();
  });
  it("does not warn for older, different-date or small genuine receipts",()=>{
    const base={supermarket:"CONFIANCA",receiptDate:"2026-10-18",originalLineCount:24,savedProductCount:20};
    expect(possibleRecentReceiptDuplicate(previous,{...base,receiptDate:"2026-10-21"},now)).toBeNull();
    expect(possibleRecentReceiptDuplicate(previous,{...base,originalLineCount:2,savedProductCount:2},now)).toBeNull();
    expect(possibleRecentReceiptDuplicate(previous,base,new Date("2026-11-01T00:00:00Z"))).toBeNull();
  });
  it("formats the local calendar date instead of interpreting the UTC day directly",()=>{
    const instant=new Date("2026-10-18T01:00:00Z");
    const expected=[instant.getFullYear(),String(instant.getMonth()+1).padStart(2,"0"),
      String(instant.getDate()).padStart(2,"0")].join("-");
    expect(currentLocalReceiptDate(instant)).toBe(expected);
  });
});
