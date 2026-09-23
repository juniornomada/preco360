import { describe, expect, it } from "vitest";
import { forceProductVisual } from "@/lib/productVisualResolver";

describe("Abobrinha Paulista photo preference", () => {
  it("uses the verified real photo when available", () => {
    expect(forceProductVisual("Abobrinha Paulista Verde Kg")).toBe(false);
  });
});
