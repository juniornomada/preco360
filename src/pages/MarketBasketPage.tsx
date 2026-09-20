import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  ShoppingBasket,
  Sparkles,
  Store,
  Split,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const db = supabase as any;
const STORAGE_KEY = "preco360-basket-selection-v1";

type Flyer = {
  id: string;
  retailer: string;
  valid_from: string;
  valid_to: string;
};

type Offer = {
  id: string;
  flyer_id: string;
  product_id: string | null;
  raw_name: string;
  normalized_name: string | null;
  advertised_price: number;
  normalized_price: number;
  base_unit: "kg" | "l" | "un";
  package_quantity: number | null;
  package_unit: string | null;
};

type OfferWithMarket = Offer & {
  retailer: string;
  validTo: string;
};

type Group = {
  key: string;
  label: string;
  baseUnit: "kg" | "l" | "un";
  offers: OfferWithMarket[];
  markets: string[];
};

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const unitLabel = (unit: "kg" | "l" | "un") => (unit === "l" ? "L" : unit);

function todayLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function dateBr(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[3] + "/" + match[2] + "/" + match[1] : value;
}

function fallbackKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedPriceLabel(offer: OfferWithMarket) {
  if (!offer.normalized_price || offer.base_unit === "un") return null;
  return brl(Number(offer.normalized_price)) + "/" + unitLabel(offer.base_unit);
}

function comparablePrice(offer: OfferWithMarket) {
  const advertised = Number(offer.advertised_price);
  const normalized = Number(offer.normalized_price);
  if (
    (offer.base_unit === "kg" || offer.base_unit === "l") &&
    Number.isFinite(normalized) &&
    normalized > 0
  ) {
    return normalized;
  }
  return advertised;
}

function compareOfferValue(a: OfferWithMarket, b: OfferWithMarket) {
  return (
    comparablePrice(a) - comparablePrice(b) ||
    Number(a.advertised_price) - Number(b.advertised_price)
  );
}

export default function MarketBasketPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [showItems, setShowItems] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSelected(JSON.parse(saved));
    } catch {
      // Optional convenience only.
    } finally {
      setSelectionHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!selectionHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch {
      // Optional convenience only.
    }
  }, [selected, selectionHydrated]);

  const today = todayLocal();

  const { data: flyers = [], isLoading: loadingFlyers } = useQuery<Flyer[]>({
    queryKey: ["active-flyers-basket", user?.id, today],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyers")
        .select("id,retailer,valid_from,valid_to")
        .lte("valid_from", today)
        .gte("valid_to", today)
        .order("retailer");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const flyerMap = useMemo(
    () => new Map(flyers.map((flyer) => [flyer.id, flyer])),
    [flyers],
  );

  const { data: offers = [], isLoading: loadingOffers } = useQuery<Offer[]>({
    queryKey: ["active-flyer-items-basket", user?.id, flyers.map((f) => f.id).join(",")],
    queryFn: async () => {
      const ids = flyers.map((flyer) => flyer.id);
      if (!ids.length) return [];
      const { data, error } = await db
        .from("flyer_items")
        .select("id,flyer_id,product_id,raw_name,normalized_name,advertised_price,normalized_price,base_unit,package_quantity,package_unit")
        .in("flyer_id", ids)
        .gt("advertised_price", 0);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !loadingFlyers,
  });

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();

    for (const offer of offers) {
      const flyer = flyerMap.get(offer.flyer_id);
      if (!flyer?.retailer) continue;

      const identityKey = offer.product_id
        ? "p:" + offer.product_id
        : "n:" + (offer.normalized_name || fallbackKey(offer.raw_name));
      if (!identityKey || identityKey === "n:") continue;

      const key = identityKey + "|u:" + offer.base_unit;

      const enriched: OfferWithMarket = {
        ...offer,
        retailer: flyer.retailer,
        validTo: flyer.valid_to,
      };

      const current = map.get(key);
      if (current) {
        current.offers.push(enriched);
        if (!current.markets.includes(flyer.retailer)) current.markets.push(flyer.retailer);
      } else {
        map.set(key, {
          key,
          label: offer.raw_name,
          baseUnit: offer.base_unit,
          offers: [enriched],
          markets: [flyer.retailer],
        });
      }
    }

    return [...map.values()].sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }),
    );
  }, [offers, flyerMap]);

  const visibleGroups = useMemo(() => {
    const q = fallbackKey(search);
    if (!q) return groups;
    const tokens = q.split(/\s+/);
    return groups.filter((group) => {
      const haystack = fallbackKey(group.label);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [groups, search]);

  const selectedGroups = useMemo(
    () =>
      groups
        .filter((group) => (selected[group.key] ?? 0) > 0)
        .map((group) => ({ ...group, quantity: selected[group.key] })),
    [groups, selected],
  );

  const comparison = useMemo(() => {
    if (!selectedGroups.length) {
      return { markets: [] as any[], bestSingle: null as any, split: null as any };
    }

    const retailerNames = [...new Set(flyers.map((flyer) => flyer.retailer).filter(Boolean))];
    const bestOfferByGroup = new Map<string, OfferWithMarket>();

    for (const group of selectedGroups) {
      const best = [...group.offers].sort(compareOfferValue)[0];
      if (best) bestOfferByGroup.set(group.key, best);
    }

    const markets = retailerNames.map((retailer) => {
      let total = 0;
      let covered = 0;
      let bestComparableTotal = 0;
      let premiumVsBest = 0;

      for (const group of selectedGroups) {
        const candidates = group.offers
          .filter((offer) => offer.retailer === retailer)
          .sort(compareOfferValue);
        const offer = candidates[0] ?? null;
        const best = bestOfferByGroup.get(group.key) ?? null;

        if (offer) {
          const offerComparablePrice = comparablePrice(offer);
          covered += 1;
          total += offerComparablePrice * group.quantity;
          if (best) {
            const bestPrice = comparablePrice(best);
            bestComparableTotal += bestPrice * group.quantity;
            premiumVsBest += (offerComparablePrice - bestPrice) * group.quantity;
          }
        }
      }

      return {
        retailer,
        total,
        covered,
        missing: selectedGroups.length - covered,
        complete: covered === selectedGroups.length,
        premiumVsBest,
        premiumPct: bestComparableTotal > 0 ? (premiumVsBest / bestComparableTotal) * 100 : 0,
      };
    });

    const completeMarkets = markets
      .filter((market) => market.complete)
      .sort((a, b) => a.total - b.total);

    const practicalMarkets = [...markets].sort(
      (a, b) =>
        b.covered - a.covered ||
        a.premiumPct - b.premiumPct ||
        a.total - b.total,
    );

    const splitRows = selectedGroups
      .map((group) => {
        const offer = bestOfferByGroup.get(group.key);
        if (!offer) return null;
        return {
          key: group.key,
          label: group.label,
          quantity: group.quantity,
          offer,
          subtotal: comparablePrice(offer) * group.quantity,
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        label: string;
        quantity: number;
        offer: OfferWithMarket;
        subtotal: number;
      }>;

    const splitTotal = splitRows.reduce((sum, row) => sum + row.subtotal, 0);
    const splitMarkets = [...new Set(splitRows.map((row) => row.offer.retailer))];

    return {
      markets,
      bestSingle: completeMarkets[0] ?? practicalMarkets[0] ?? null,
      split: { total: splitTotal, rows: splitRows, markets: splitMarkets },
    };
  }, [selectedGroups, flyers]);

  const bestSingle = comparison.bestSingle;
  const split = comparison.split;
  const exactSavings =
    bestSingle?.complete && split
      ? Math.max(0, bestSingle.total - split.total)
      : null;

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = { ...current };
      if ((next[key] ?? 0) > 0) delete next[key];
      else next[key] = 1;
      return next;
    });

  const changeQty = (key: string, delta: number) =>
    setSelected((current) => {
      const next = { ...current };
      const value = Math.max(0, Math.min(99, (next[key] ?? 0) + delta));
      if (!value) delete next[key];
      else next[key] = value;
      return next;
    });

  return (
    <div className="page-container mx-auto w-full max-w-3xl">
      <header className="mb-4">
        <button
          type="button"
          onClick={() => navigate("/offers")}
          className="mb-3 flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para Ofertas
        </button>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Cesta 360</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Qual mercado vale mais a pena?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monte sua lista e compare os tabloides que estão vigentes hoje.
        </p>
      </header>

      {(loadingFlyers || loadingOffers) && (
        <Card className="mb-4">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Carregando promoções vigentes…
          </CardContent>
        </Card>
      )}

      {!loadingFlyers && flyers.length < 2 && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <p className="font-semibold">Importe pelo menos dois tabloides vigentes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Hoje há {flyers.length} supermercado(s) com tabloide vigente.
            </p>
          </CardContent>
        </Card>
      )}

      {selectedGroups.length > 0 && bestSingle && (
        <div className="mb-4 space-y-3">
          <Card className="border-primary/35 bg-primary/5">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/15 p-2.5 text-primary">
                  <Store className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {bestSingle.complete ? "Melhor mercado único" : "Melhor opção prática"}
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold">{bestSingle.retailer}</h2>
                  <p className="mt-1 text-sm">
                    {bestSingle.covered}/{selectedGroups.length} itens da sua lista em promoção
                    {bestSingle.complete ? " · total " + brl(bestSingle.total) : ""}
                  </p>
                  {!bestSingle.complete && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {bestSingle.missing} item(ns) não aparecem no tabloide vigente deste mercado.
                      O Radar não inventa preço para completar a cesta.
                    </p>
                  )}
                  {exactSavings !== null && exactSavings > 0 && (
                    <p className="mt-2 text-xs font-medium text-muted-foreground">
                      Dividir a compra entre os mercados mais baratos economizaria {brl(exactSavings)},
                      mas exigiria {split?.markets.length ?? 0} mercado(s).
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {split && split.markets.length > 1 && (
            <details className="rounded-xl border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-semibold">
                <Split className="h-4 w-4 text-primary" />
                Menor custo equivalente dividindo a compra
                <span className="ml-auto font-extrabold">{brl(split.total)}</span>
              </summary>
              <div className="space-y-2 border-t p-3">
                {split.rows.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 p-3">
                    <div className="min-w-0">
                      <p className="font-medium">{row.quantity}× {row.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.offer.retailer} · válido até {dateBr(row.offer.validTo)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold">{brl(row.subtotal)}</p>
                      {normalizedPriceLabel(row.offer) ? (
                        <>
                          <p className="text-[11px] text-muted-foreground">
                            equivalente · {normalizedPriceLabel(row.offer)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            embalagem {brl(Number(row.offer.advertised_price))}
                          </p>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <ShoppingBasket className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="font-bold">Minha lista</p>
              <p className="text-xs text-muted-foreground">
                {selectedGroups.length} item(ns) selecionado(s)
              </p>
            </div>
            {selectedGroups.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected({})}>Limpar</Button>
            )}
          </div>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Arroz, leite, pão, carne..."
              className="h-11 pl-9"
            />
          </div>

          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between text-sm font-semibold"
            onClick={() => setShowItems((value) => !value)}
          >
            Escolher produtos das promoções vigentes
            {showItems ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showItems && (
            <div className="mt-3 max-h-[54vh] space-y-2 overflow-y-auto pr-1">
              {visibleGroups.map((group) => {
                const qty = selected[group.key] ?? 0;
                const best = [...group.offers].sort(compareOfferValue)[0];
                return (
                  <div
                    key={group.key}
                    role="button"
                    tabIndex={0}
                    aria-pressed={qty > 0}
                    aria-label={
                      qty
                        ? "Remover " + group.label + " da lista"
                        : "Adicionar " + group.label + " à lista"
                    }
                    onClick={() => toggle(group.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggle(group.key);
                      }
                    }}
                    className={
                      "cursor-pointer select-none rounded-xl border p-3 transition active:scale-[0.995] " +
                      (qty
                        ? "border-primary/50 bg-primary/10 ring-1 ring-primary/20"
                        : "bg-card hover:border-primary/25")
                    }
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={
                          "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition " +
                          (qty
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground")
                        }
                      >
                        {qty ? <Check className="h-5 w-5" /> : null}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug">{group.label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {group.markets.length} mercado(s) ·{" "}
                          {best && normalizedPriceLabel(best)
                            ? "melhor custo " + normalizedPriceLabel(best) +
                              " · embalagem " + brl(Number(best.advertised_price))
                            : "melhor oferta " + brl(Number(best?.advertised_price ?? 0))}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-primary">
                          {qty ? "Selecionado" : "Toque no produto para adicionar"}
                        </p>
                      </div>

                      {qty > 0 && (
                        <div
                          className="flex shrink-0 items-center gap-1 rounded-lg border bg-background p-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            aria-label={"Diminuir quantidade de " + group.label}
                            className="flex h-9 w-9 items-center justify-center rounded-md text-lg active:bg-muted"
                            onClick={(event) => {
                              event.stopPropagation();
                              changeQty(group.key, -1);
                            }}
                          >−</button>
                          <span className="min-w-8 text-center text-sm font-bold">
                            {qty}{group.baseUnit === "un" ? "" : " " + unitLabel(group.baseUnit)}
                          </span>
                          <button
                            type="button"
                            aria-label={"Aumentar quantidade de " + group.label}
                            className="flex h-9 w-9 items-center justify-center rounded-md text-lg active:bg-muted"
                            onClick={(event) => {
                              event.stopPropagation();
                              changeQty(group.key, 1);
                            }}
                          >+</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {!loadingOffers && visibleGroups.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhuma oferta vigente encontrada para essa busca.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedGroups.length > 0 && comparison.markets.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="font-bold">Comparação por supermercado</h2>
          </div>
          {[...comparison.markets]
            .sort((a, b) =>
              Number(b.complete) - Number(a.complete) ||
              b.covered - a.covered ||
              a.total - b.total,
            )
            .map((market) => (
              <Card key={market.retailer}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{market.retailer}</p>
                      <p className="text-xs text-muted-foreground">
                        {market.covered}/{selectedGroups.length} itens encontrados
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-extrabold">
                        {market.complete ? brl(market.total) : market.covered + " itens"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {market.complete
                          ? selectedGroups.some((group) => group.baseUnit !== "un")
                            ? "cesta equivalente por kg/L"
                            : "cesta promocional completa"
                          : market.missing + " sem preço no tabloide"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Para produtos em g/kg ou ml/L, a Cesta 360 compara pelo valor equivalente em R$/kg ou R$/L:
        cada quantidade selecionada representa 1 kg ou 1 L de referência, enquanto o preço da
        embalagem continua visível. Itens por unidade usam o preço da embalagem. O comparador usa
        somente preços dos tabloides importados e ainda vigentes. Ausência de um item no tabloide
        não significa que o mercado não venda o produto — apenas que não temos um preço promocional
        válido para ele.
      </p>
    </div>
  );
}
