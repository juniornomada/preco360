import { describe,it,expect } from "vitest";
import { normalizeProductSearchText,productMatchesSearch } from "@/lib/productSearch";
describe("fiscal receipt abbreviation and root aliases",()=>{
  it("finds cappuccino even when receipt says CAPP.3 CORACOES 200g",()=>{
    expect(productMatchesSearch("CAPP.3 CORACOES 200g","cappuccino")).toBe(true);
    expect(productMatchesSearch("Cappuccino 3 Corações Classic 200g","capp")).toBe(true);
    expect(productMatchesSearch("CAFE SOL 3 CORACOES 40g","cappuccino")).toBe(false);
  });
  it("matches batata-baroa and mandioquinha without confusing English potatoes",()=>{
    expect(productMatchesSearch("Batata-baroa (mandioquinha) kg","mandioquinha")).toBe(true);
    expect(productMatchesSearch("Batata-baroa (mandioquinha) kg","batata baroa")).toBe(true);
    expect(productMatchesSearch("BATATA INGLESA kg","mandioquinha")).toBe(false);
    expect(productMatchesSearch("BATATA MONALISA kg","mandioquinha")).toBe(false);
    expect(normalizeProductSearchText("Batata baroa")).toBe("batata baroa");
  });
});