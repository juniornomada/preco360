import { describe, expect, it } from "vitest";
import { canonicalRetailerName } from "@/lib/retailerNames";

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

  it("keeps other retailers unchanged", () => {
    expect(canonicalRetailerName("Tauste")).toBe("Tauste");
    expect(canonicalRetailerName("Max Atacadista")).toBe("Max Atacadista");
  });
});
