import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import ProductCard from "@/components/ProductCard";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export default function SearchPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const { data: products } = useQuery({
    queryKey: ["products-search", user?.id],
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

  const filtered = products?.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const withBest = filtered?.map((p) => {
    const prices = p.prices ?? [];
    const best = prices.reduce(
      (min, pr) => (pr.price < min.price ? pr : min),
      prices[0] ?? { price: 0, supermarket: "-", date: "" }
    );
    return { ...p, bestPrice: best.price, bestSupermarket: best.supermarket, bestDate: best.date };
  });

  return (
    <div className="page-container">
      <h1 className="mb-4 text-xl font-bold">Buscar Produtos</h1>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Digite o nome do produto..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="space-y-3">
        {withBest?.map((p) => (
          <ProductCard
            key={p.id}
            id={p.id}
            name={p.name}
            category={p.category}
            bestPrice={p.bestPrice}
            bestSupermarket={p.bestSupermarket}
            bestDate={p.bestDate}
          />
        ))}
        {search && withBest?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum produto encontrado para "{search}".
          </p>
        )}
      </div>
    </div>
  );
}
