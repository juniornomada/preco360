/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProductDetail from "@/pages/ProductDetail";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  update: vi.fn(),
  rpc: vi.fn(),
}));

const product = {
  id: "test-product-id",
  name: "SALG TORCIDA 60G",
  category: "Geral",
  brand: null,
  package_size: 60,
  unit: "g",
  prices: [{
    id: "price-1",
    price: 2.1,
    date: "2026-10-20",
    supermarket: "Max Atacadista",
    source: "receipt",
    receipt_text: null,
  }],
};

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: product.id }),
  useNavigate: () => mocked.navigate,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "test-user" } }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocked.toast }),
}));
vi.mock("@/components/PriceChart", () => ({ default: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: product }),
  useQueryClient: () => ({ invalidateQueries: mocked.invalidate, removeQueries: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (value: unknown) => {
        mocked.update(value);
        return {
          eq: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      },
    }),
    rpc: (...args: unknown[]) => mocked.rpc(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocked.rpc.mockResolvedValue({ error: null });
  mocked.invalidate.mockResolvedValue(undefined);
});

describe("Product edits return to Cotar, not Ofertas", () => {
  it("returns to Cotar with the product selected after renaming", async () => {
    render(<ProductDetail />);
    fireEvent.click(screen.getByRole("button", { name: "Editar nome do produto" }));
    fireEvent.change(screen.getByDisplayValue("SALG TORCIDA 60G"), {
      target: { value: "SALG TORCIDA 60G ATUALIZADO" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome do produto" }));

    await waitFor(() => {
      expect(mocked.navigate).toHaveBeenCalledWith(
        "/search?product=test-product-id",
        { replace: true },
      );
    });
    expect(mocked.update).toHaveBeenCalledWith({ name: "SALG TORCIDA 60G ATUALIZADO" });
    expect(mocked.invalidate).toHaveBeenCalledWith({
      queryKey: ["product-summaries", "test-user"],
    });
  });

  it("returns to Cotar after a successful receipt price correction", async () => {
    render(<ProductDetail />);
    fireEvent.click(screen.getByRole("button", { name: "Editar valor pago" }));
    fireEvent.change(screen.getByLabelText("Valor efetivamente pago (R$)"), {
      target: { value: "2,05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => {
      expect(mocked.navigate).toHaveBeenCalledWith(
        "/search?product=test-product-id",
        { replace: true },
      );
    });
    expect(mocked.rpc).toHaveBeenCalledWith("correct_receipt_price_v1", {
      p_price_id: "price-1",
      p_effective_price: 2.05,
      p_reason: "Desconto aplicado no subtotal do cupom fiscal",
    });
  });

  it("does not leave the edit screen if price correction fails", async () => {
    mocked.rpc.mockResolvedValue({ error: { message: "Falha na correção" } });
    render(<ProductDetail />);
    fireEvent.click(screen.getByRole("button", { name: "Editar valor pago" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => {
      expect(mocked.toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Não foi possível corrigir o valor",
      }));
    });
    expect(mocked.navigate).not.toHaveBeenCalled();
  });
});
