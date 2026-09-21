import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AddProductModal from "@/components/AddProductModal";
import AdaptiveProductName from "@/components/AdaptiveProductName";
import { formatBRL } from "@/lib/priceAnalysis";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeDollarSign, ChevronRight, CircleDollarSign, PackageSearch, Plus, ReceiptText, ShoppingBasket, Tags } from "lucide-react";

export default function Index() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);

  const { data: products, refetch, isLoading } = useQuery({
    queryKey: ["products", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*, prices(*)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const totalPrices = useMemo(
    () => products?.reduce((sum, product) => sum + (product.prices?.length ?? 0), 0) ?? 0,
    [products],
  );

  const productRows = useMemo(() => {
    if (!products) return [];
    return products.map((product) => {
      const prices = [...(product.prices ?? [])].sort((a, b) => b.date.localeCompare(a.date));
      const latest = prices[0];
      const best = prices.length ? Math.min(...prices.map((item) => item.price)) : null;
      return { ...product, latest, best, priceCount: prices.length };
    });
  }, [products]);

  return (
    <div className="page-container mx-auto w-full max-w-3xl">
      <header className="mb-4 flex items-center justify-between gap-3 sm:mb-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm sm:h-11 sm:w-11">
            <CircleDollarSign className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[clamp(1.2rem,5vw,1.5rem)] font-extrabold leading-tight tracking-tight">Preço 360</h1>
            <p className="truncate text-[clamp(0.72rem,3vw,0.82rem)] text-muted-foreground">Seu histórico antes de comprar</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-10 shrink-0 rounded-xl px-3 text-xs sm:text-sm" onClick={() => setShowAdd(true)}>
          <Plus className="mr-1 h-4 w-4" /> Produto
        </Button>
      </header>

      <section className="relative mb-4 overflow-hidden rounded-[1.35rem] bg-secondary p-4 text-secondary-foreground shadow-sm sm:mb-5 sm:p-6">
        <div className="relative z-10 max-w-xl">
          <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/60 sm:text-xs">Decida com histórico</p>
          <h2 className="max-w-[16ch] text-[clamp(1.7rem,7.6vw,2.25rem)] font-extrabold leading-[1.08] tracking-[-0.02em]">
            Esse preço está realmente bom?
          </h2>
          <p className="mt-3 max-w-[42rem] text-[clamp(0.84rem,3.5vw,0.96rem)] leading-[1.55] text-white/70">
            Veja ofertas vigentes, compare com o seu histórico e descubra onde vale a pena comprar antes de sair de casa.
          </p>
          <div className="mt-4 grid gap-2 sm:mt-5 sm:grid-cols-2">
            <Button className="h-10 rounded-xl text-sm sm:h-11" onClick={() => navigate("/offers")}>
              <Tags className="mr-2 h-4 w-4" /> Consultar ofertas
            </Button>
            <Button variant="secondary" className="h-10 rounded-xl bg-white/10 text-sm text-white hover:bg-white/15 sm:h-11" onClick={() => navigate("/search")}>
              <BadgeDollarSign className="mr-2 h-4 w-4" /> Cotar na loja
            </Button>
          </div>
        </div>
        <ShoppingBasket className="absolute -bottom-7 -right-5 h-32 w-32 text-white/[0.04] sm:h-40 sm:w-40" />
      </section>

      <section className="mb-5 grid grid-cols-2 gap-2.5 sm:mb-6 sm:gap-3">
        <Card className="rounded-2xl">
          <CardContent className="p-3.5 sm:p-4">
            <PackageSearch className="mb-1.5 h-5 w-5 text-primary" />
            <p className="text-[clamp(1.65rem,7vw,2rem)] font-extrabold leading-none">{products?.length ?? 0}</p>
            <p className="mt-1 text-[clamp(0.68rem,2.8vw,0.78rem)] leading-tight text-muted-foreground">produtos acompanhados</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-3.5 sm:p-4">
            <ReceiptText className="mb-1.5 h-5 w-5 text-amber-600" />
            <p className="text-[clamp(1.65rem,7vw,2rem)] font-extrabold leading-none">{totalPrices}</p>
            <p className="mt-1 text-[clamp(0.68rem,2.8vw,0.78rem)] leading-tight text-muted-foreground">preços registrados</p>
          </CardContent>
        </Card>
      </section>

      <section>
        <div className="mb-2.5 flex items-end justify-between gap-3 sm:mb-3">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">Acompanhe</p>
            <h2 className="text-[clamp(1.1rem,5vw,1.3rem)] font-bold leading-tight">Seus produtos</h2>
          </div>
          {products && products.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs sm:text-sm" onClick={() => navigate("/search")}>Cotar preço</Button>
          )}
        </div>

        {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Carregando...</p>}

        {!isLoading && products?.length === 0 && (
          <Card className="rounded-2xl border-dashed"><CardContent className="flex flex-col items-center px-5 py-8 text-center sm:py-9">
            <PackageSearch className="mb-3 h-9 w-9 text-primary" />
            <h3 className="font-bold">Comece pelo primeiro produto</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Cadastre os itens que você compra com frequência e forme seu histórico de preços.</p>
            <Button className="mt-4" onClick={() => setShowAdd(true)}><Plus className="mr-2 h-4 w-4" />Cadastrar produto</Button>
          </CardContent></Card>
        )}

        <div className="space-y-2">
          {productRows.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => navigate(`/product/${product.id}`)}
              className="flex w-full items-center gap-2.5 rounded-2xl border bg-card px-3.5 py-3 text-left transition active:scale-[0.995] hover:border-primary/30 hover:shadow-sm sm:gap-3 sm:p-4"
            >
              <div className="min-w-0 flex-1">
                <AdaptiveProductName text={product.name} className="font-semibold" maxPx={16} desktopMaxPx={16} />
                <p className="mt-0.5 truncate text-[clamp(0.66rem,2.8vw,0.75rem)] text-muted-foreground">{product.category} · {product.priceCount} registro(s)</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[clamp(0.82rem,3.5vw,0.95rem)] font-extrabold">{product.latest ? formatBRL(product.latest.price) : "Sem preço"}</p>
                <p className="text-[0.64rem] text-muted-foreground sm:text-[11px]">{product.best !== null ? `melhor ${formatBRL(product.best)}` : "sem histórico"}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>

      <AddProductModal open={showAdd} onClose={() => setShowAdd(false)} onAdded={refetch} />
    </div>
  );
}
