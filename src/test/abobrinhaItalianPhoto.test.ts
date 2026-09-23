import { describe, expect, it } from "vitest";
import { forceProductVisual } from "@/lib/productVisualResolver";

describe("Abobrinha Italiana photo preference", () => {
  it("uses a verified real photo when available", () => {
    expect(forceProductVisual("Abobrinha Italiana")).toBe(false);
  });
});
