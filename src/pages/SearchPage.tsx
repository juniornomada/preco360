import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { analyzePrice, formatBRL } from "@/lib/priceAnalysis";
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
};

function searchTokens(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized) return [];

  return normalized.split(/\s+/).flatMap((token) => {
    const alias = SEARCH_ALIASES[token];
    return alias ? [token, alias] : [token];
  });
}

function productMatchesSearch(name: string, query: string) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return true;

  const nameTokens = searchTokens(name);
  return queryTokens.every((queryToken) =>
    nameTokens.some((nameToken) => {
      if (nameToken.includes(queryToken)) return true;
      // Aceita abreviações de cupom como MUSS. → mussarela, BISC. → biscoito etc.
      return queryToken.length >= 4 && nameToken.length >= 4 && queryToken.startsWith(nameToken);
    }),
  );
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState("");
  const [supermarket, setSupermarket] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products-quote", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, prices(*)")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    if (!products) return [];
    return products.filter((product) => productMatchesSearch(product.name, search));
  }, [products, search]);

  const selected = useMemo(
    () => products?.find((product) => product.id === selectedId) ?? null,
    [products, selectedId],
  );

  const numericPrice = Number(currentPrice.replace(",", "."));
  const analysis = selected && numericPrice > 0
    ? analyzePrice(numericPrice, selected.prices ?? [])
    : null;
  const style = analysis ? verdictStyle[analysis.verdict] : null;
  const VerdictIcon = style?.Icon;

  const selectProduct = (id: string) => {
    setSelectedId(id);
    setCurrentPrice("");
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
        description: `${selected.name} por ${formatBRL(numericPrice)} em ${supermarket.trim()}.`,
      });
      setCurrentPrice("");
      queryClient.invalidateQueries({ queryKey: ["products-quote"] });
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
          autoFocus
        />
      </div>

      {!selected && (
        <div className="space-y-2">
          {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Carregando produtos...</p>}

          {!isLoading && products?.length === 0 && (
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
            const prices = [...(product.prices ?? [])].sort((a, b) => b.date.localeCompare(a.date));
            const latest = prices[0];
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
                  <p className="truncate font-semibold">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{product.prices?.length ?? 0} preço(s) no histórico</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{latest ? formatBRL(latest.price) : "Sem preço"}</p>
                  <p className="text-[11px] text-muted-foreground">{latest ? formatDateBr(latest.date) : "sem histórico"}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}

          {search && filtered.length === 0 && products && products.length > 0 && (
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
                  <div>
                    <h2 className="text-xl font-bold">{selected.name}</h2>
                    <p className="text-xs text-muted-foreground">{selected.category}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/product/${selected.id}`)}>Ver histórico</Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Preço encontrado</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm font-semibold text-muted-foreground">R$</span>
                    <Input inputMode="decimal" placeholder="0,00" className="h-11 pl-10 text-lg font-bold" value={currentPrice} onChange={(event) => setCurrentPrice(event.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Supermercado</label>
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
