import { describe, expect, it } from "vitest";
import { canonicalRetailerName, displayRetailerName, retailerLogoPath } from "@/lib/retailerNames";

describe("canonicalRetailerName", () => {
  it("normalizes Kawakami variants", () => {
    expect(canonicalRetailerName("Supermercados Kawakami")).toBe("Kawakami");
    expect(canonicalRetailerName("Supermercado Kawakami")).toBe("Kawakami");
    expect(canonicalRetailerName("Kawakami")).toBe("Kawakami");
  });

  it("normalizes Confiança variants", () => {
    expect(canonicalRetailerName("Confiança Supermercados")).toBe("Confiança");
    expect(canonicalRetailerName("Supermercados Confiança")).toBe("Confiança");
    expect(canonicalRetailerName("Confiança")).toBe("Confiança");
  });


  it("keeps distinct Confiança stores separate and logo consistent", () => {
    expect(canonicalRetailerName("CONFIANCA ESMERALDA")).toBe("Confiança Esmeralda");
    expect(canonicalRetailerName("CONFIANCA AQUARIUS")).toBe("Confiança Aquarius");
    expect(retailerLogoPath("CONFIANCA ESMERALDA")).toBe("/retailer-logos/confianca.webp");
    expect(retailerLogoPath("CONFIANCA AQUARIUS")).toBe("/retailer-logos/confianca.webp");
  });

  it("applies the same readable casing to all known chain names, including old receipts", () => {
    expect(displayRetailerName("MAX ATACADISTA")).toBe("Max Atacadista");
    expect(displayRetailerName("Max Atacadista")).toBe("Max Atacadista");
    expect(displayRetailerName("TAUSTE SUPERMERCADOS LTDA")).toBe("Tauste");
    expect(displayRetailerName("EMPORIO GALDENCIO LTDA")).toBe("Empório Galdêncio");
    expect(displayRetailerName("SUPERMERCADOS CONFIANCA LTDA")).toBe("Confiança");
    expect(displayRetailerName("CONFIANCA ESMERALDA")).toBe("Confiança Esmeralda");
    expect(displayRetailerName("CONFIANCA AQUARIUS")).toBe("Confiança Aquarius");
    expect(displayRetailerName("Supermercados Kawakami Ltda")).toBe("Kawakami");
  });

  it("formats unknown networks safely without merging distinct companies", () => {
    expect(displayRetailerName("DORI ALIMENTOS S.A.")).toBe("Dori Alimentos S.A.");
    expect(displayRetailerName("IRMAOS MUFFATO E CIA LTDA")).toBe("Irmaos Muffato e Cia Ltda");
    expect(displayRetailerName("SUPERMERCADOS KAWAKANI LTDA")).toBe("Supermercados Kawakani Ltda");
    expect(displayRetailerName("REDE XPTO DO BAIRRO")).toBe("Rede Xpto do Bairro");
    expect(displayRetailerName("")).toBe("");
  });

  it("keeps other retailers unchanged", () => {
    expect(canonicalRetailerName("Tauste")).toBe("Tauste");
    expect(canonicalRetailerName("Max Atacadista")).toBe("Max Atacadista");
  });
});
