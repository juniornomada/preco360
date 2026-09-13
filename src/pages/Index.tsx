import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import ProductCard from "@/components/ProductCard";
import AddProductModal from "@/components/AddProductModal";
import PriceChart from "@/components/PriceChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Search, ShoppingCart, CalendarIcon, X, Trash2, Sparkles, Loader2 } from "lucide-react";

export default function Index() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);

  const selectMode = selected.size > 0;



  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!productsWithBest) return;
    if (selected.size === productsWithBest.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(productsWithBest.map((p) => p.id)));
    }
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      // Delete prices first (foreign key), then products
      const ids = Array.from(selected);
      const { error: prErr } = await supabase.from("prices").delete().in("product_id", ids);
      if (prErr) throw prErr;
      const { error: pErr } = await supabase.from("products").delete().in("id", ids);
      if (pErr) throw pErr;
      toast({ title: `${ids.length} produto(s) apagado(s)` });
      setSelected(new Set());
      setShowDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err: any) {
      toast({ title: "Erro ao apagar", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const { data: products, refetch } = useQuery({
    queryKey: ["products", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, prices(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const geralCount = useMemo(() => products?.filter((p) => p.category === "Geral").length ?? 0, [products]);

  const recategorizeGeral = useCallback(async () => {
    if (!products || geralCount === 0) return;
    setRecategorizing(true);
    try {
      const geralProducts = products.filter((p) => p.category === "Geral");
      const names = geralProducts.map((p) => p.name);

      const { data, error } = await supabase.functions.invoke("categorize-products", {
        body: { products: names },
      });
      if (error) throw error;

      const categories: Record<string, string> = data?.categories ?? {};
      let updated = 0;

      for (const product of geralProducts) {
        const newCat = categories[product.name] ??
          Object.entries(categories).find(([k]) => k.toLowerCase() === product.name.toLowerCase())?.[1];
        if (newCat && newCat !== "Geral") {
          const { error: uErr } = await supabase.from("products").update({ category: newCat }).eq("id", product.id);
          if (!uErr) updated++;
        }
      }

      toast({ title: `${updated} produto(s) recategorizado(s)` });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err: any) {
      toast({ title: "Erro ao recategorizar", description: err.message, variant: "destructive" });
    } finally {
      setRecategorizing(false);
    }
  }, [products, geralCount, toast, queryClient]);

  const categories = useMemo(() => {
    const cats = [...new Set(products?.map((p) => p.category) ?? [])];
    return cats.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [products]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    products?.forEach((p) => {
      counts[p.category] = (counts[p.category] || 0) + 1;
    });
    return counts;
  }, [products]);

  // Filter prices by date range, then compute best price from filtered prices
  const filtered = products
    ?.map((p) => {
      let prices = p.prices ?? [];
      if (dateFrom) {
        const fromStr = format(dateFrom, "yyyy-MM-dd");
        prices = prices.filter((pr) => pr.date >= fromStr);
      }
      if (dateTo) {
        const toStr = format(dateTo, "yyyy-MM-dd");
        prices = prices.filter((pr) => pr.date <= toStr);
      }
      return { ...p, prices };
    })
    .filter((p) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === "all" || p.category === categoryFilter;
      const hasPrices = !dateFrom && !dateTo ? true : p.prices.length > 0;
      return matchSearch && matchCat && hasPrices;
    });

  const productsWithBest = filtered?.map((p) => {
    const prices = p.prices ?? [];
    const best = prices.reduce(
      (min, pr) => (pr.price < min.price ? pr : min),
      prices[0] ?? { price: 0, supermarket: "-", date: "" }
    );
    return { ...p, bestPrice: best.price, bestSupermarket: best.supermarket, bestDate: best.date };
  });

  // All prices for chart (also filtered by date)
  const allPrices = filtered?.flatMap((p) => (p.prices ?? []).map((pr) => ({
    date: pr.date,
    price: pr.price,
    supermarket: pr.supermarket,
  }))) ?? [];

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <ShoppingCart className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">Preço Tracker</h1>
        </div>
        <div className="flex items-center gap-2">
          {selectMode && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Cancelar
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setShowDeleteConfirm(true)} disabled={selected.size === 0 || deleting}>
                <Trash2 className="h-4 w-4" />
                Apagar ({selected.size})
              </Button>
            </>
          )}
          {!selectMode && geralCount > 0 && (
            <Button size="sm" variant="outline" onClick={recategorizeGeral} disabled={recategorizing}>
              {recategorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Recategorizar ({geralCount})
            </Button>
          )}
          {!selectMode && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" />
              Novo
            </Button>
          )}
        </div>
      </div>

      {/* Select all bar */}
      {selectMode && productsWithBest && productsWithBest.length > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
          <Checkbox
            checked={selected.size === productsWithBest.length && productsWithBest.length > 0}
            onCheckedChange={selectAll}
          />
          <span className="text-sm text-muted-foreground">
            {selected.size === productsWithBest.length ? "Desmarcar todos" : "Selecionar todos"}
          </span>
        </div>
      )}

      {/* Search */}
      <div className="mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar produto..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Category Filter Chips */}
      {categories.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Badge
            variant={categoryFilter === "all" ? "default" : "outline"}
            className="cursor-pointer transition-colors"
            onClick={() => setCategoryFilter("all")}
          >
            Todas ({products?.length || 0})
          </Badge>
          {categories.map((c) => (
            <Badge
              key={c}
              variant={categoryFilter === c ? "default" : "outline"}
              className="cursor-pointer transition-colors"
              onClick={() => setCategoryFilter(categoryFilter === c ? "all" : c)}
            >
              {c} ({categoryCounts[c] || 0})
            </Badge>
          ))}
        </div>
      )}

      {/* Date Range Filter */}
      <div className="mb-4 flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "flex-1 justify-start text-left text-xs font-normal",
                !dateFrom && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
              {dateFrom ? format(dateFrom, "dd/MM/yyyy", { locale: ptBR }) : "Data início"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom}
              onSelect={setDateFrom}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "flex-1 justify-start text-left text-xs font-normal",
                !dateTo && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
              {dateTo ? format(dateTo, "dd/MM/yyyy", { locale: ptBR }) : "Data fim"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo}
              onSelect={setDateTo}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        {hasDateFilter && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Price Chart */}
      {allPrices.length > 0 && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-card-foreground">Histórico de Preços</h2>
          <PriceChart data={allPrices} />
        </div>
      )}

      {/* Product List — click to select, double-click or tap to navigate */}
      <p className="mb-2 text-xs text-muted-foreground">
        {selectMode ? "Clique para selecionar/desmarcar. Pressione Cancelar para sair." : "Clique para selecionar. Duplo clique para ver detalhes."}
      </p>
      <div className="space-y-3">
        {productsWithBest && productsWithBest.length > 0 ? (
          productsWithBest.map((p) => (
            <div
              key={p.id}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg transition-colors",
                selected.has(p.id) && "ring-2 ring-primary ring-offset-2"
              )}
              onClick={() => toggleSelect(p.id)}
              onDoubleClick={() => navigate(`/product/${p.id}`)}
            >
              <Checkbox
                checked={selected.has(p.id)}
                onCheckedChange={() => toggleSelect(p.id)}
                className="mt-4 ml-1"
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex-1">
                <ProductCard
                  id={p.id}
                  name={p.name}
                  category={p.category}
                  bestPrice={p.bestPrice}
                  bestSupermarket={p.bestSupermarket}
                  bestDate={p.bestDate}
                />
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <ShoppingCart className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {hasDateFilter ? "Nenhum preço encontrado nesse período." : "Nenhum produto cadastrado."}
            </p>
            {!hasDateFilter && (
              <Button variant="outline" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4" />
                Adicionar produto
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja apagar {selected.size} produto(s) e todos os preços associados? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddProductModal open={showAdd} onClose={() => setShowAdd(false)} onAdded={refetch} />
    </div>
  );
}
