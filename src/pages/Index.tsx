import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AddProductModal from "@/components/AddProductModal";
import { formatBRL } from "@/lib/priceAnalysis";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeDollarSign, Camera, ChevronRight, CircleDollarSign, PackageSearch, Plus, ReceiptText, ShoppingBasket } from "lucide-react";

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
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <CircleDollarSign className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Preço 360</h1>
            <p className="text-xs text-muted-foreground">Seu histórico antes de comprar</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="mr-1 h-4 w-4" /> Produto
        </Button>
      </header>

      <section className="relative mb-5 overflow-hidden rounded-2xl bg-secondary p-5 text-secondary-foreground shadow-sm sm:p-6">
        <div className="relative z-10 max-w-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Decida com histórico</p>
          <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">Esse preço está realmente bom?</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            Compare o preço da prateleira com o que você já pagou e registre novos valores para melhorar a análise.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button className="h-11" onClick={() => navigate("/search")}>
              <BadgeDollarSign className="mr-2 h-4 w-4" /> Cotar preço agora
            </Button>
            <Button variant="secondary" className="h-11 bg-white/10 text-white hover:bg-white/15" onClick={() => navigate("/upload")}>
              <Camera className="mr-2 h-4 w-4" /> Ler cupom fiscal
            </Button>
          </div>
        </div>
        <ShoppingBasket className="absolute -bottom-8 -right-6 h-40 w-40 text-white/[0.04]" />
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3">
        <Card><CardContent className="p-4"><PackageSearch className="mb-2 h-5 w-5 text-primary" /><p className="text-2xl font-extrabold">{products?.length ?? 0}</p><p className="text-xs text-muted-foreground">produtos acompanhados</p></CardContent></Card>
        <Card><CardContent className="p-4"><ReceiptText className="mb-2 h-5 w-5 text-amber-600" /><p className="text-2xl font-extrabold">{totalPrices}</p><p className="text-xs text-muted-foreground">preços registrados</p></CardContent></Card>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Acompanhe</p><h2 className="text-lg font-bold">Seus produtos</h2></div>
          {products && products.length > 0 && <Button variant="ghost" size="sm" onClick={() => navigate("/search")}>Cotar preço</Button>}
        </div>

        {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Carregando...</p>}

        {!isLoading && products?.length === 0 && (
          <Card className="border-dashed"><CardContent className="flex flex-col items-center px-5 py-9 text-center">
            <PackageSearch className="mb-3 h-9 w-9 text-primary" />
            <h3 className="font-bold">Comece pelo primeiro produto</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Cadastre os itens que você compra com frequência e forme seu histórico de preços.</p>
            <Button className="mt-4" onClick={() => setShowAdd(true)}><Plus className="mr-2 h-4 w-4" />Cadastrar produto</Button>
          </CardContent></Card>
        )}

        <div className="space-y-2.5">
          {productRows.map((product) => (
            <button key={product.id} type="button" onClick={() => navigate(`/product/${product.id}`)} className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/30 hover:shadow-sm">
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{product.name}</p><p className="text-xs text-muted-foreground">{product.category} · {product.priceCount} registro(s)</p></div>
              <div className="text-right"><p className="text-sm font-extrabold">{product.latest ? formatBRL(product.latest.price) : "Sem preço"}</p><p className="text-[11px] text-muted-foreground">{product.best !== null ? `melhor ${formatBRL(product.best)}` : "sem histórico"}</p></div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>

      <AddProductModal open={showAdd} onClose={() => setShowAdd(false)} onAdded={refetch} />
    </div>
  );
}
