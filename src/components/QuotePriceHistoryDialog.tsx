import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatBRL } from "@/lib/priceAnalysis";
import { formatNormalizedPrice } from "@/lib/flyerAnalysis";
import { displayRetailerName } from "@/lib/retailerNames";
import { unitPriceForProduct } from "@/lib/productUnitPricing";
import { withVerifiedQuotePackage } from "@/lib/quoteProductDisplay";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const db = supabase as any;

export type QuoteHistoryProduct = {
  id: string;
  name: string;
  package_size: number | string | null;
  unit: string | null;
};

type HistoryRow = {
  product_id: string;
  price: number | string;
  date: string;
  supermarket: string;
};

function formatDateBr(value?: string | null) {
  if (!value) return "Sem data";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/**
 * Read-only price history that overlays /search or /search-beta.
 * The quote page remains mounted, preserving query text and price inputs.
 * Uses the existing user-scoped history RPC; no new tables or write requests.
 */
export default function QuotePriceHistoryDialog({
  open, onOpenChange, product, displayName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: QuoteHistoryProduct | null;
  displayName: string;
}) {
  const { user } = useAuth();
  const { data: history = [], isLoading, isError } = useQuery<HistoryRow[]>({
    queryKey: ["selected-price-history", user?.id, product?.id],
    enabled: open && !!user && !!product,
    queryFn: async ({ signal }) => {
      const { data, error } = await db
        .rpc("get_product_price_history_v1", {
          p_product_ids: [product!.id],
          p_per_product_limit: 60,
        })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as HistoryRow[];
    },
  });

  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const displayProduct = product ? withVerifiedQuotePackage(product) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.25rem)] max-w-lg max-h-[85dvh] overflow-y-auto rounded-xl p-4 sm:p-6">
        <DialogHeader className="pr-5 text-left">
          <DialogTitle>Histórico de preços</DialogTitle>
          <DialogDescription className="break-words text-sm">{displayName}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p role="status" className="py-5 text-sm text-muted-foreground">Carregando histórico...</p>
        ) : isError ? (
          <p role="alert" className="py-5 text-sm text-destructive">Não foi possível carregar o histórico. Feche e tente novamente.</p>
        ) : sorted.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">Nenhum preço registrado para este produto.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {sorted.length === 60 ? "Mostrando até 60 registros mais recentes" : `${sorted.length} ${sorted.length === 1 ? "registro encontrado" : "registros encontrados"}`}
            </p>
            <div className="space-y-2" aria-label="Preços registrados">
              {sorted.map((row, i) => {
                const price = Number(row.price);
                const comparable = displayProduct && Number.isFinite(price) && price > 0
                  ? unitPriceForProduct(
                      displayProduct.name,
                      displayProduct.package_size,
                      displayProduct.unit,
                      price,
                    )
                  : null;
                return (
                  <div key={`${row.product_id}-${row.date}-${i}`} className="rounded-lg border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 break-words text-sm font-semibold">
                        {displayRetailerName(row.supermarket) || "Supermercado não informado"}
                      </p>
                      <p className="shrink-0 text-base font-bold tabular-nums">{formatBRL(price)}</p>
                    </div>
                    <div className="mt-1.5 flex flex-wrap justify-between gap-1.5 text-xs">
                      <span className="text-muted-foreground">{formatDateBr(row.date)}</span>
                      {comparable && (
                        <span className="font-semibold tabular-nums text-primary">
                          {formatNormalizedPrice(comparable.normalizedPrice, comparable.baseUnit)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="w-full">
          Fechar histórico
        </Button>
      </DialogContent>
    </Dialog>
  );
}
