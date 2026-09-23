import { describe, expect, it } from "vitest";
import { processingCompatible } from "../../supabase/functions/_shared/image-candidate-rules";

describe("processingCompatible", () => {
  it("rejects shredded beef for a fresh/generic rib offer", () => {
    expect(
      processingCompatible(
        "Costela Bovina",
        "Costela Bovina Desfiada Alfama 1kg congelado https://loja/produto/costela-bovina-desfiada",
      ),
    ).toBe(false);
  });

  it("accepts a matching raw beef rib image", () => {
    expect(
      processingCompatible(
        "Costela Bovina",
        "Costela bovina em tiras 1,35kg",
      ),
    ).toBe(true);
  });

  it("allows processed form when the offer itself asks for it", () => {
    expect(
      processingCompatible(
        "Carne Bovina Desfiada",
        "Carne bovina desfiada congelada",
      ),
    ).toBe(true);
  });

  it("rejects other processed forms when absent from the offer", () => {
    expect(processingCompatible("Patinho Bovino", "Patinho bovino cozido")).toBe(false);
    expect(processingCompatible("Acém Bovino", "Hambúrguer de acém bovino")).toBe(false);
  });
});
