import { CalendarDays, ChevronRight, History } from "lucide-react";

export type PriceQuoteSearchResultProps = {
  name: string;
  price: string;
  normalizedPrice: string | null;
  historyCount: number;
  date: string | null;
  onSelect: () => void;
};

/**
 * Price-first quotation card for both /search and /search-beta.
 * Product identity gets a full-width title that may wrap naturally.
 * No product pictures or decorative icons take up title space.
 * Prices and comparable kg/L/unit references remain below the title.
 */
export default function PriceQuoteSearchResult({
  name, price, normalizedPrice, historyCount, date, onSelect,
}: PriceQuoteSearchResultProps) {
  const count = Number.isFinite(historyCount) ? Math.max(0, historyCount) : 0;
  const historyText = count
    ? `${count} ${count === 1 ? "preço" : "preços"} no histórico`
    : "Sem preços no histórico";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${name}. Último preço ${price}. ${normalizedPrice ? `Referência ${normalizedPrice}. ` : ""}${historyText}. ${date ?? "Data indisponível"}`}
      className="w-full rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 break-words text-sm font-bold leading-snug text-foreground sm:text-base">
          {name}
        </h3>
        <ChevronRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="mt-2.5 grid grid-cols-2 items-end gap-2 border-t border-border/60 pt-2.5">
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">Referência por kg/L/un.</p>
          <p className="break-words text-sm font-semibold tabular-nums text-primary sm:text-base">
            {normalizedPrice ?? "Sem referência"}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[11px] text-muted-foreground">Último preço</p>
          <p className="text-base font-extrabold tabular-nums text-foreground sm:text-lg">{price}</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground sm:text-xs">
        <span className="inline-flex items-center gap-1">
          <History aria-hidden="true" className="h-3 w-3 shrink-0" />
          {historyText}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarDays aria-hidden="true" className="h-3 w-3 shrink-0" />
          {date ?? "Sem data"}
        </span>
      </div>
    </button>
  );
}
