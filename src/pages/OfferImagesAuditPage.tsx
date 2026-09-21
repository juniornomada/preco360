import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ImageOff, Search, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ProductVisual from "@/components/ProductVisual";
import { normalizeSearchText } from "@/lib/flyerAnalysis";

const db = supabase as any;

type FlyerRow = {
  id: string;
  retailer: string;
  title?: string | null;
  valid_from: string | null;
  valid_to: string | null;
};

type FlyerItemImageRow = {
  id: string;
  flyer_id: string;
  raw_name: string;
  brand?: string | null;
  package_quantity?: number | string | null;
  package_unit?: string | null;
  advertised_price?: number | string | null;
  image_url?: string | null;
  image_source?: string | null;
  image_match_status?: string | null;
  image_confidence?: number | string | null;
};

type AuditItem = FlyerItemImageRow & {
  retailer: string;
  valid_to: string | null;
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function imageHost(value?: string | null) {
  if (!value) return "Sem URL";
  if (value.startsWith("data:")) return "imagem manual";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "URL cadastrada";
  }
}

function packageLabel(item: FlyerItemImageRow) {
  if (!item.package_quantity || !item.package_unit) return null;
  return `${item.package_quantity}${item.package_unit}`;
}

export default function OfferImagesAuditPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = useMemo(() => localDateKey(), []);
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(60);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["offer-images-audit", user?.id, today],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data: flyers, error: flyersError } = await db
        .from("flyers")
        .select("id,retailer,valid_to")
        .eq("user_id", user!.id)
        .lte("valid_from", today)
        .gte("valid_to", today)
        .order("created_at", { ascending: false });

      if (flyersError) throw flyersError;

      const activeFlyers = (flyers ?? []) as FlyerRow[];
      const flyerIds = activeFlyers.map((flyer) => flyer.id);
      if (!flyerIds.length) {
        return { flyers: activeFlyers, items: [] as AuditItem[] };
      }

      const { data: items, error: itemsError } = await db
        .from("flyer_items")
        .select(
          "id,flyer_id,raw_name,brand,package_quantity,package_unit,advertised_price,image_url,image_source,image_match_status",
        )
        .eq("user_id", user!.id)
        .in("flyer_id", flyerIds)
        .order("raw_name", { ascending: true })
        .limit(5000);

      if (itemsError) throw itemsError;

      const flyerById = new Map(activeFlyers.map((flyer) => [flyer.id, flyer]));
      const auditItems = ((items ?? []) as FlyerItemImageRow[]).map((item) => {
        const flyer = flyerById.get(item.flyer_id);
        return {
          ...item,
          retailer: flyer?.retailer ?? "Supermercado",
          valid_to: flyer?.valid_to ?? null,
        };
      });

      return { flyers: activeFlyers, items: auditItems };
    },
  });

  const items = data?.items ?? [];
  const missingCount = items.filter((item) => !item.image_url).length;
  const withImageCount = items.length - missingCount;

  const searchableItems = useMemo(
    () =>
      items.map((item) => ({
        item,
        searchText: normalizeSearchText(
          `${item.raw_name} ${item.brand ?? ""} ${item.retailer}`,
        ),
      })),
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query).trim();
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

    return searchableItems
      .filter(({ item, searchText }) => {
        if (onlyMissing && item.image_url) return false;
        if (!tokens.length) return true;
        return tokens.every((token) => searchText.includes(token));
      })
      .map(({ item }) => item);
  }, [searchableItems, onlyMissing, query]);

  useEffect(() => {
    setVisibleLimit(60);
  }, [query, onlyMissing]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleLimit),
    [filteredItems, visibleLimit],
  );
  const hasMore = visibleItems.length < filteredItems.length;

  useEffect(() => {
    if (!hasMore || !loadMoreRef.current) return;

    const node = loadMoreRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleLimit((current) =>
          Math.min(current + 60, filteredItems.length),
        );
      },
      { rootMargin: "500px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, filteredItems.length, visibleLimit]);

  return (
    <div className="page-container !pb-24 mx-auto w-full max-w-3xl">
      <header className="mb-4">
        <Button
          type="button"
          variant="ghost"
          className="mb-2 h-8 px-2 text-xs font-bold"
          onClick={() => navigate("/offers")}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Voltar para ofertas
        </Button>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          Preço 360 · Auditoria de imagens
        </p>
        <h1 className="mt-1 text-[clamp(1.55rem,6vw,2.05rem)] font-extrabold leading-tight tracking-tight">
          Produtos vigentes
        </h1>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Liste todas as ofertas atuais e filtre os itens sem imagem cadastrada.
        </p>
      </header>

      <div className="relative mb-2">
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="h-12 pl-10 text-base"
          placeholder="Filtrar por produto, marca ou mercado..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={onlyMissing ? "outline" : "default"}
          className="h-10 rounded-xl text-xs font-bold"
          onClick={() => setOnlyMissing(false)}
        >
          Todos ({items.length})
        </Button>
        <Button
          type="button"
          variant={onlyMissing ? "default" : "outline"}
          className="h-10 rounded-xl text-xs font-bold"
          onClick={() => setOnlyMissing(true)}
        >
          <ImageOff className="mr-1.5 h-3.5 w-3.5" />
          Sem imagem ({missingCount})
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full border bg-card px-2.5 py-1">
          {data?.flyers.length ?? 0} tabloide(s) vigente(s)
        </span>
        <span className="rounded-full border bg-card px-2.5 py-1">
          {withImageCount} com imagem
        </span>
        <span className="rounded-full border bg-card px-2.5 py-1">
          {missingCount} sem imagem
        </span>
      </div>

      {isLoading && (
        <Card className="border-dashed">
          <CardContent className="p-7 text-center text-sm text-muted-foreground">
            Carregando produtos vigentes…
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5">
            <p className="font-bold text-destructive">Não consegui carregar os produtos</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Tente novamente."}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filteredItems.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-7 text-center">
            <ImageOff className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-3 font-bold">Nenhum produto encontrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajuste o filtro ou alterne entre todos e sem imagem.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filteredItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {onlyMissing ? "Produtos sem imagem" : "Todos os produtos"}
              </p>
              <p className="text-sm font-bold">
                {filteredItems.length} produto(s) listado(s)
              </p>
            </div>
          </div>

          {visibleItems.map((item) => {
            const price = Number(item.advertised_price) || 0;
            const pack = packageLabel(item);
            const hasImage = Boolean(item.image_url);

            return (
              <Card key={item.id} className={!hasImage ? "border-amber-500/30" : ""}>
                <CardContent className="p-3 sm:p-4">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 sm:gap-x-3">
                    <ProductVisual
                      name={item.raw_name}
                      category="Produto"
                      imageUrl={item.image_url ?? null}
                    />

                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-bold leading-tight sm:text-base"
                        title={item.raw_name}
                      >
                        {item.raw_name}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-bold">
                          <Store className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate">{item.retailer}</span>
                        </span>
                        {pack && (
                          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {pack}
                          </span>
                        )}
                        <span
                          className={
                            "rounded-full border px-2 py-0.5 text-[10px] font-bold " +
                            (hasImage
                              ? "border-green-500/30 bg-green-500/10 text-green-500"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-500")
                          }
                        >
                          {hasImage ? "Com imagem" : "Sem imagem"}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                        {hasImage
                          ? `${item.image_source ?? "imagem"} · ${imageHost(item.image_url)} · status ${item.image_match_status ?? "—"}`
                          : `status ${item.image_match_status ?? "sem imagem"}`}
                      </p>
                    </div>

                    <div className="min-w-[82px] shrink-0 text-right">
                      <p className="text-lg font-extrabold leading-tight">
                        {brl(price)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {hasMore && (
            <div
              ref={loadMoreRef}
              className="py-4 text-center text-xs text-muted-foreground"
            >
              Carregando mais produtos…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
