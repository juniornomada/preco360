/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import QuotePriceHistoryDialog from "@/components/QuotePriceHistoryDialog";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-user" } }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      { product_id: "p1", supermarket: "MAX ATACADISTA", date: "2026-10-20", price: 2.1 },
      { product_id: "p1", supermarket: "CONFIANCA ESMERALDA", date: "2026-09-22", price: 1.57 },
    ],
    isLoading: false,
    isError: false,
  }),
}));

describe("Cotar in-place history modal", () => {
  it("shows dated store prices and closes without navigating away", () => {
    const onOpenChange = vi.fn();
    render(
      <QuotePriceHistoryDialog
        open
        onOpenChange={onOpenChange}
        product={{ id: "p1", name: "SALG TORCIDA 60G", package_size: 60, unit: "g" }}
        displayName="Salg Torcida 60 g"
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Salg Torcida 60 g")).toBeTruthy();
    expect(screen.getByText("Max Atacadista")).toBeTruthy();
    expect(screen.getByText("Confiança Esmeralda")).toBeTruthy();
    expect(screen.getByText("R$ 2,10")).toBeTruthy();
    expect(screen.getByText("R$ 1,57")).toBeTruthy();
    expect(screen.getByText("R$ 35,00/kg")).toBeTruthy();
    expect(screen.getByText("20/10/2026")).toBeTruthy();
    expect(screen.getByText("22/09/2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fechar histórico" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
