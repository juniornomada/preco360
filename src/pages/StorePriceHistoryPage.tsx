import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import ProductSearchBar from "@/components/ProductSearchBar";
import { productMatchesSearch } from "@/lib/productSearch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronRight,
  History,
  Store,
  TrendingDown,
} from "lucide-react";

const db = supabase as any;

type StoreObservation = {
  id: string;
  product_id: string | null;
  supermarket: string;
  observed_date: string;
  raw_name: string;
  package_quantity: number | string | null;
  package_unit: string | null;
  retail_price: number | string;
  wholesale_price: number | string | null;
  wholesale_min_quantity: number | null;
  normalized_retail_price: number | string | null;
  normalized_wholesale_price: number | string | null;
  base_unit: "kg" | "l" | "un" | null;
  created_at: string;
  products:
    | {
        id: string;
        name: string;
        package_size: number | string | null;
        unit: string | null;
      }
    | null;
};

type ProductGroup = {
  productId: string;
  name: string;
  rows: StoreObservation[];
  latest: StoreObservation;
  best: StoreObservation;
  median: number;
};

const brl = (value: number) =>
  value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

function dateBr(value?: string | null) {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function packageLabel(
  quantity: number | string | null,
  unit: string | null,
) {
  const numeric = Number(quantity);
  if (!Number.isFinite(numeric) || numeric <= 0 || !unit) return "";

  const normalizedUnit = unit.trim().toLowerCase();
  const shownUnit =
    normalizedUnit === "l" || normalizedUnit === "lt"
      ? "L"
      : normalizedUnit;

  return `${numeric.toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
  })} ${shownUnit}`;
}

function displayName(row: StoreObservation) {
  const base = row.products?.name?.trim() || row.raw_name.trim();
  const packageAlreadyInName =
    /\d+(?:[.,]\d+)?\s*(kg|g|ml|l|lt|un|und|unid)\s*$/i.test(base);

  if (packageAlreadyInName) return base;

  const label = packageLabel(
    row.products?.package_size ?? row.package_quantity,
    row.products?.unit ?? row.package_unit,
  );

  return label ? `${base} ${label}` : base;
}

function normalizedLabel(row: StoreObservation) {
  const price = Number(row.normalized_retail_price);
  if (!Number.isFinite(price) || price <= 0 || !row.base_unit) return null;
  const unit = row.base_unit === "l" ? "L" : row.base_unit;
  return `${brl(price)}/${unit}`;
}

function median(values: number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;

  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export default function StorePriceHistoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: observations = [], isLoading, error } = useQuery<
    StoreObservation[]
  >({
    queryKey: ["store-price-history", user?.id],
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await db
        .from("store_price_observations")
        .select(
          "id,product_id,supermarket,observed_date,raw_name,package_quantity,package_unit,retail_price,wholesale_price,wholesale_min_quantity,normalized_retail_price,normalized_wholesale_price,base_unit,created_at,products(id,name,package_size,unit)",
        )
        .eq("user_id", user!.id)
        .not("product_id", "is", null)
        .order("observed_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(600);

      if (error) throw error;
      return (data ?? []) as StoreObservation[];
    },
  });

  const groups = useMemo<ProductGroup[]>(() => {
    const grouped = new Map<string, StoreObservation[]>();

    for (const row of observations) {
      if (!row.product_id) continue;
      const rows = grouped.get(row.product_id) ?? [];
      rows.push(row);
      grouped.set(row.product_id, rows);
    }

    return [...grouped.entries()]
      .map(([productId, rows]) => {
        const latest = [...rows].sort((a, b) => {
          const dateDiff = String(b.observed_date).localeCompare(
            String(a.observed_date),
          );
          if (dateDiff) return dateDiff;
          return String(b.created_at).localeCompare(String(a.created_at));
        })[0];

        const best = [...rows].sort(
          (a, b) => Number(a.retail_price) - Number(b.retail_price),
        )[0];

        return {
          productId,
          name: displayName(latest),
          rows,
          latest,
          best,
          median: median(rows.map((row) => Number(row.retail_price))),
        };
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR", {
          sensitivity: "base",
        }),
      );
  }, [observations]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;

    return groups.filter((group) =>
      productMatchesSearch(
        [group.name, ...group.rows.map((row) => row.supermarket)].join(" "),
        search,
      ),
    );
  }, [groups, search]);

  return (
    <div className="page-container !pb-24 mx-auto w-full max-w-3xl">
      <header className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          Preço 360 · Ofertas · Gôndola
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          Seus preços de referência
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Consulte os preços que você fotografou nas lojas e use o histórico
          para decidir se o preço encontrado agora vale a pena.
        </p>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 gap-2 rounded-xl font-bold"
          onClick={() => navigate("/offers")}
        >
          <TrendingDown className="h-4 w-4 text-primary" />
          Ofertas atuais
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 gap-2 rounded-xl font-bold"
          onClick={() => navigate("/radar/store-prices")}
        >
          <Store className="h-4 w-4 text-primary" />
          Registrar preços
        </Button>
      </div>

      <ProductSearchBar
        className="mb-3"
        value={search}
        onChange={(value) => setSearch(value)}
        placeholder="Busque Heineken 350 ml, suco, Qboa..."
      />

      {isLoading && (
        <Card className="border-dashed">
          <CardContent className="p-7 text-center text-sm text-muted-foreground">
            Carregando preços de gôndola…
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5">
            <p className="font-bold text-destructive">
              Não consegui carregar o histórico
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Tente novamente."}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && groups.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-7 text-center">
            <History className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-3 font-bold">
              Nenhum preço de gôndola salvo ainda
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Registre os principais produtos que você acompanha para formar
              sua base de referência.
            </p>
            <Button
              className="mt-4"
              onClick={() => navigate("/radar/store-prices")}
            >
              Registrar preços
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && groups.length > 0 && (
        <div className="space-y-2">
          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {groups.length} produto(s) · {observations.length} registro(s)
            </span>
            {search && <span>{filtered.length} resultado(s)</span>}
          </div>

          {filtered.map((group) => {
            const latestPrice = Number(group.latest.retail_price);
            const bestPrice = Number(group.best.retail_price);
            const normalized = normalizedLabel(group.latest);
            const wholesale = Number(group.latest.wholesale_price);

            return (
              <Card key={group.productId} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <Store className="h-5 w-5 text-primary" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="font-bold leading-snug">{group.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {group.rows.length} registro(s) no histórico de gôndola
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-muted/60 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Último
                      </p>
                      <p className="mt-0.5 text-sm font-extrabold">
                        {brl(latestPrice)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-muted/60 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Menor
                      </p>
                      <p className="mt-0.5 text-sm font-extrabold text-primary">
                        {brl(bestPrice)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-muted/60 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Referência
                      </p>
                      <p className="mt-0.5 text-sm font-extrabold">
                        {brl(group.median)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground/80">
                      {group.latest.supermarket}
                    </span>
                    <span>·</span>
                    <span>{dateBr(group.latest.observed_date)}</span>
                    {normalized && (
                      <>
                        <span>·</span>
                        <span className="font-semibold text-primary">
                          {normalized}
                        </span>
                      </>
                    )}
                  </div>

                  {Number.isFinite(wholesale) && wholesale > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Atacado:{" "}
                      <strong className="text-foreground">
                        {brl(wholesale)}
                      </strong>
                      {group.latest.wholesale_min_quantity
                        ? ` a partir de ${group.latest.wholesale_min_quantity} un.`
                        : ""}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/search?product=${encodeURIComponent(
                          group.productId,
                        )}`,
                      )
                    }
                    className="mt-3 flex h-10 w-full items-center justify-between rounded-xl border border-primary/25 bg-primary/5 px-3 text-sm font-bold text-primary transition hover:bg-primary/10"
                  >
                    <span>Comparar preço encontrado agora</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </CardContent>
              </Card>
            );
          })}

          {search && filtered.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Nenhum preço de gôndola encontrado para “{search}”.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
