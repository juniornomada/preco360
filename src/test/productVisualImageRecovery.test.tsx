// @vitest-environment jsdom

import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProductVisual from "@/components/ProductVisual";

describe("ProductVisual image recovery", () => {
  it("shows a new image URL after the previous image failed", async () => {
    const { container, rerender } = render(
      <ProductVisual
        name="Abobrinha Italiana"
        imageUrl="https://example.test/old.webp"
      />,
    );

    const firstImage = container.querySelector("img");
    expect(firstImage).not.toBeNull();
    fireEvent.error(firstImage!);
    expect(firstImage?.className).toContain("hidden");

    rerender(
      <ProductVisual
        name="Abobrinha Italiana"
        imageUrl="https://example.test/new.webp"
      />,
    );

    await waitFor(() => {
      const nextImage = container.querySelector("img");
      expect(nextImage?.getAttribute("src")).toBe(
        "https://example.test/new.webp",
      );
      expect(nextImage?.className).toContain("block");
    });
  });
});
