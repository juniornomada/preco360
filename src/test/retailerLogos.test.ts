import { describe, expect, it } from "vitest";
import { canonicalRetailerName, retailerLogoPath } from "@/lib/retailerNames";

describe("identificação das logos de supermercado", () => {
  it.each(["Kawakami", "Supermercados Kawakami", "KAWAKAMI supermercados"])(
    "identifica variação do Kawakami: %s",
    (name) => {
      expect(canonicalRetailerName(name)).toBe("Kawakami");
      expect(retailerLogoPath(name)).toContain("/retailer-logos/kawakami.webp");
    },
  );

  it.each(["Swift", "Loja Swift", "Swift Carnes", "SWIFT"])(
    "identifica variação da Swift: %s",
    (name) => {
      expect(canonicalRetailerName(name)).toBe("Swift");
      expect(retailerLogoPath(name)).toBe("/retailer-logos/swift.svg");
    },
  );

  it("preserva as logos das outras redes", () => {
    expect(retailerLogoPath("Max Atacadista")).toBe("/retailer-logos/max-atacadista.webp");
    expect(retailerLogoPath("Atacadão")).toBe("/retailer-logos/atacadao.webp");
    expect(retailerLogoPath("Confiança")).toBe("/retailer-logos/confianca.webp");
    expect(retailerLogoPath("Tauste")).toBe("/retailer-logos/tauste.webp");
    expect(retailerLogoPath("Empório Galdêncio")).toBe("/retailer-logos/emporio-galdencio.webp");
  });

  it("mantém fallback para rede sem imagem", () => {
    expect(retailerLogoPath("Mercado desconhecido")).toBeNull();
  });
});
