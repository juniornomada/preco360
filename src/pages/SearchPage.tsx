import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

type ProductSummary = {
  id: string;
  name: string;
  category: string | null;
  package_size: number | string | null;
  unit: string | null;
  price_count: number | string;
  latest_price: number | string | null;
  latest_date: string | null;
  latest_supermarket: string | null;
  best_price: number | string | null;
};

type PriceHistoryRow = {
  product_id: string;
  price: number | string;
  date: string;
  supermarket: string;
};
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { analyzePrice, formatBRL } from "@/lib/priceAnalysis";
import {
  formatNormalizedPrice,
  inferPackage,
  normalizedUnitPrice,
} from "@/lib/flyerAnalysis";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Search,
  Store,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Minus,
  Sparkles,
  Save,
  ChevronRight,
} from "lucide-react";

const verdictStyle = {
  exceptional: { className: "border-emerald-500/30 bg-emerald-500/10", iconClass: "text-emerald-600", Icon: Sparkles },
  good: { className: "border-green-500/30 bg-green-500/10", iconClass: "text-green-600", Icon: TrendingDown },
  normal: { className: "border-amber-500/30 bg-amber-500/10", iconClass: "text-amber-600", Icon: Minus },
  high: { className: "border-red-500/30 bg-red-500/10", iconClass: "text-red-600", Icon: TrendingUp },
  insufficient: { className: "border-border bg-muted/50", iconClass: "text-muted-foreground", Icon: CheckCircle2 },
} as const;

const SEARCH_ALIASES: Record<string, string> = {
  qj: "queijo",
  qjo: "queijo",
  mus: "mussarela",
  muss: "mussarela",
  mussar: "mussarela",
  mussarela: "mussarela",
  mozzarella: "mussarela",
};

function searchTokens(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized) return [];

  return normalized.split(/\s+/).map((token) => SEARCH_ALIASES[token] ?? token);
}

function productMatchesSearch(name: string, query: string) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return true;

  const nameTokens = searchTokens(name);
  return queryTokens.every((queryToken) =>
    nameTokens.some((nameToken) => {
      if (nameToken.includes(queryToken) || queryToken.includes(nameToken)) return true;
      return queryToken.length >= 4 && nameToken.length >= 3 && queryToken.startsWith(nameToken);
    }),
  );
}

function packageLabel(
  quantity: number | string | null,
  unit: string | null,
) {
  const numericQuantity = Number(quantity);
  if (
    !Number.isFinite(numericQuantity) ||
    numericQuantity <= 0 ||
    !unit
  ) {
    return "";
  }

  const normalizedUnit = unit.trim().toLowerCase();
  const shownUnit =
    normalizedUnit === "l" || normalizedUnit === "lt" ? "L" : normalizedUnit;
  return `${numericQuantity.toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
  })} ${shownUnit}`;
}

function displayProductName(product: ProductSummary) {
  const clean = product.name.trim();
  if (!clean) return clean;
  if (inferPackage(clean)) return clean;

  const label = packageLabel(product.package_size, product.unit);
  return label ? `${clean} ${label}` : clean;
}

function normalizedSummaryPrice(
  product: ProductSummary,
  price: number | string | null,
) {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return null;

  const pkg =
    product.package_size && product.unit
      ? inferPackage(`${product.package_size}${product.unit}`)
      : inferPackage(product.name);
  if (!pkg) return null;

  return normalizedUnitPrice(numericPrice, pkg);
}

function formatDateBr(value?: string | null) {
  if (!value) return "sem histórico";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export default function SearchPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState("");
  const [supermarket, setSupermarket] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: products = [], isLoading } = useQuery<ProductSummary[]>({
    queryKey: ["product-summaries", user?.id],
    queryFn: async () => {
      const { data, error } = await db.rpc("product_summaries_v1");
      if (error) throw error;
      return ((data ?? []) as ProductSummary[]).sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
      );
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    if (!products) return [];
    return products.filter((product) =>
      productMatchesSearch(displayProductName(product), search),
    );
  }, [products, search]);

  const requestedProductId = searchParams.get("product");

  useEffect(() => {
    if (!requestedProductId || !products.length) return;
    if (
      selectedId !== requestedProductId &&
      products.some((product) => product.id === requestedProductId)
    ) {
      setSelectedId(requestedProductId);
      setCurrentPrice("");
      setSupermarket("");
    }
  }, [requestedProductId, products, selectedId]);

  const selected = useMemo(
    () => products.find((product) => product.id === selectedId) ?? null,
    [products, selectedId],
  );

  const { data: selectedHistory = [] } = useQuery<PriceHistoryRow[]>({
    queryKey: ["selected-price-history", user?.id, selectedId],
    enabled: !!user && !!selectedId,
    queryFn: async ({ signal }) => {
      const { data, error } = await db
        .rpc("get_product_price_history_v1", {
          p_product_ids: [selectedId],
          p_per_product_limit: 60,
        })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as PriceHistoryRow[];
    },
  });

  const selectedLatest =
    selected?.latest_price !== null && selected?.latest_price !== undefined
      ? {
          price: Number(selected.latest_price),
          date: selected.latest_date,
          supermarket: selected.latest_supermarket ?? "",
        }
      : null;
  const selectedDisplayName = selected ? displayProductName(selected) : "";
  const selectedNormalizedLatest =
    selected && selectedLatest
      ? normalizedSummaryPrice(selected, selectedLatest.price)
      : null;

  const numericPrice = Number(currentPrice.replace(",", "."));
  const analysis = selected && numericPrice > 0
    ? analyzePrice(
        numericPrice,
        selectedHistory.map((row) => ({
          ...row,
          price: Number(row.price),
        })),
      )
    : null;
  const style = analysis ? verdictStyle[analysis.verdict] : null;
  const VerdictIcon = style?.Icon;

  const selectProduct = (id: string) => {
    setSelectedId(id);
    setCurrentPrice("");
    setSupermarket("");
  };

  const savePrice = async () => {
    if (!user || !selected || !numericPrice || numericPrice <= 0 || !supermarket.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("prices").insert({
        user_id: user.id,
        product_id: selected.id,
        supermarket: supermarket.trim(),
        price: numericPrice,
        date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;

      toast({
        title: "Preço registrado",
        description: `${displayProductName(selected)} por ${formatBRL(numericPrice)} em ${supermarket.trim()}.`,
      });
      setCurrentPrice("");
      queryClient.invalidateQueries({ queryKey: ["product-summaries", user.id] });
      queryClient.invalidateQueries({ queryKey: ["selected-price-history", user.id, selected.id] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product", selected.id] });
    } catch (error: any) {
      toast({ title: "Erro ao registrar preço", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container mx-auto w-full max-w-2xl">
      <header className="mb-5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Cotar no mercado</p>
        <h1 className="text-2xl font-extrabold tracking-tight">Esse preço vale a pena?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha o produto, informe o preço da prateleira e compare com o seu próprio histórico.
        </p>
      </header>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Café, leite, banana, mussarela..."
          className="h-11 pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {!selected && (
        <div className="space-y-2">
          {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Carregando produtos...</p>}

          {!isLoading && products.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="p-5 text-center">
                <p className="font-semibold">Você ainda não acompanha nenhum produto.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cadastre o primeiro produto na tela inicial e comece a formar seu histórico.
                </p>
                <Button className="mt-4" onClick={() => navigate("/")}>Ir para o início</Button>
              </CardContent>
            </Card>
          )}

          {filtered.map((product) => {
            const latest =
              product.latest_price !== null && product.latest_price !== undefined
                ? {
                    price: Number(product.latest_price),
                    date: product.latest_date,
                  }
                : null;
            const displayName = displayProductName(product);
            const normalizedLatest = latest
              ? normalizedSummaryPrice(product, latest.price)
              : null;
            return (
              <button
                type="button"
                key={product.id}
                onClick={() => selectProduct(product.id)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <TrendingDown className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{displayName}</p>
                  <p className="text-xs text-muted-foreground">{Number(product.price_count ?? 0)} preço(s) no histórico</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{latest ? formatBRL(latest.price) : "Sem preço"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {latest
                      ? normalizedLatest
                        ? `${formatNormalizedPrice(
                            normalizedLatest.normalizedPrice,
                            normalizedLatest.baseUnit,
                          )} · ${formatDateBr(latest.date)}`
                        : formatDateBr(latest.date)
                      : "sem histórico"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}

          {search && filtered.length === 0 && products.length > 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado para “{search}”.</p>
          )}
        </div>
      )}

      {selected && (
        <div className="space-y-4">
          <button type="button" onClick={() => setSelectedId(null)} className="text-sm font-medium text-primary hover:underline">
            ← Escolher outro produto
          </button>

          <Card>
            <CardContent className="p-5">
              <div className="mb-4">
                <p className="text-xs font-medium text-muted-foreground">Produto</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold">{selectedDisplayName}</h2>
                    <p className="text-xs text-muted-foreground">{selected.category}</p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate(`/product/${selected.id}`)}>Ver histórico</Button>
                </div>
              </div>

              {selectedLatest && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Último preço registrado</p>
                    <p className="mt-0.5 text-lg font-extrabold">
                      {formatBRL(selectedLatest.price)}
                    </p>
                    {selectedNormalizedLatest && (
                      <p className="text-[11px] font-semibold text-primary">
                        {formatNormalizedPrice(
                          selectedNormalizedLatest.normalizedPrice,
                          selectedNormalizedLatest.baseUnit,
                        )}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0 text-right text-xs text-muted-foreground">
                    <p className="truncate font-medium text-foreground/80">{selectedLatest.supermarket}</p>
                    <p>{formatDateBr(selectedLatest.date)}</p>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Preço encontrado agora</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm font-semibold text-muted-foreground">R$</span>
                    <Input inputMode="decimal" placeholder="Ex.: 38,90" className="h-11 pl-10 text-lg font-bold" value={currentPrice} onChange={(event) => setCurrentPrice(event.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Supermercado atual</label>
                  <div className="relative">
                    <Store className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Ex.: Confiança" className="h-11 pl-9" value={supermarket} onChange={(event) => setSupermarket(event.target.value)} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {analysis && style && VerdictIcon && (
            <Card className={style.className}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-background/80 p-2"><VerdictIcon className={`h-5 w-5 ${style.iconClass}`} /></div>
                  <div className="flex-1">
                    <p className={`text-lg font-extrabold ${style.iconClass}`}>{analysis.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-foreground/80">{analysis.message}</p>
                    {analysis.historyCount >= 2 && (
                      <p className="mt-2 text-xs font-medium text-muted-foreground">
                        Está <span className="font-bold text-foreground">{Math.abs(analysis.differenceFromMedianPct).toFixed(1)}%</span>{" "}
                        {analysis.differenceFromMedianPct < 0 ? "abaixo" : "acima"} da mediana do seu histórico.
                      </p>
                    )}
                  </div>
                </div>

                {analysis.historyCount >= 2 && (
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-current/10 pt-4 text-center">
                    <div><p className="text-[11px] text-muted-foreground">Menor</p><p className="text-sm font-bold">{formatBRL(analysis.min)}</p></div>
                    <div><p className="text-[11px] text-muted-foreground">Preço típico</p><p className="text-sm font-bold">{formatBRL(analysis.median)}</p></div>
                    <div><p className="text-[11px] text-muted-foreground">Maior</p><p className="text-sm font-bold">{formatBRL(analysis.max)}</p></div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Button className="h-12 w-full text-base" disabled={!numericPrice || numericPrice <= 0 || !supermarket.trim() || saving} onClick={savePrice}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Registrando..." : "Registrar este preço"}
          </Button>
        </div>
      )}
    </div>
  );
}
