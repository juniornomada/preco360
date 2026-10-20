import { CalendarDays, ChevronRight, History, Package } from "lucide-react";
import ProductVisual from "@/components/ProductVisual";
import { isPastryRollWithoutPhoto } from "@/lib/quoteProductDisplay";

export type PriceQuoteSearchResultProps = {
  name: string;
  category?: string | null;
  imageUrl?: string | null;
  price: string;
  normalizedPrice: string | null;
  historyCount: number;
  date: string | null;
  onSelect: () => void;
};

/**
 * Layout approved for "Cotar no mercado":
 * - full name, including package, in one horizontally scrollable line
 * - per-kg/litre/unit price left; package price right
 * - history count left; date right
 *
 * The title scrolls instead of being truncated so no product identity is lost.
 * No inferred package image is used; ProductVisual falls back to a safe icon
 * whenever there is no verified image URL.
 */
export default function PriceQuoteSearchResult({
  name, category, imageUrl, price, normalizedPrice, historyCount, date, onSelect,
}: PriceQuoteSearchResultProps) {
  const count = Number.isFinite(historyCount) ? Math.max(0, historyCount) : 0;
  const historyText = count
    ? `${count} ${count === 1 ? "preço" : "preços"} no histórico`
    : "Sem preços no histórico";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${name}. Preço ${price}. ${normalizedPrice ? `Equivalente ${normalizedPrice}. ` : ""}${historyText}. ${date ?? "Data indisponível"}`}
      className="w-full rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2.5 sm:grid-cols-[3.75rem_minmax(0,1fr)]">
        {isPastryRollWithoutPhoto(name, imageUrl) ? (
          <div
            role="img"
            aria-label="Massa para pastel em rolo; foto da embalagem indisponível"
            className="flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center rounded-xl border border-white/10 bg-muted/50 text-muted-foreground sm:h-14 sm:w-14"
          >
            <Package aria-hidden="true" className="h-6 w-6" />
            <span aria-hidden="true" className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide">Rolo</span>
          </div>
        ) : (
          <ProductVisual name={name} category={category} imageUrl={imageUrl} compact />
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <div
              className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              title={name}
            >
              <span className="whitespace-nowrap text-[clamp(10px,2.6vw,14px)] font-bold leading-5 tracking-tight text-foreground">
                {name}
              </span>
            </div>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 py-2">
            <span className="min-w-0 text-[11px] font-bold text-primary sm:text-sm">
              {normalizedPrice ?? "Preço unitário indisponível"}
            </span>
            <span className="shrink-0 text-base font-extrabold tabular-nums text-foreground sm:text-lg">
              {price}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1.5 border-t border-border/60 pt-2 text-[10px] text-muted-foreground sm:text-xs">
            <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
              <History aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span>{historyText}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
              <CalendarDays aria-hidden="true" className="h-3 w-3" />
              <span>{date ?? "Sem data"}</span>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
