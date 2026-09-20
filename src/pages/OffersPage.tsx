import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  BadgeCheck,
  ChevronRight,
  Clock3,
  History,
  Radar,
  Search,
  ShoppingBasket,
  Sparkles,
  Store,
  Tags,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  evaluateFlyerOffer,
  formatNormalizedPrice,
  inferPackage,
  matchFlyerItem,
  normalizeSearchText,
  normalizedUnitPrice,
  type FlyerCandidate,
  type ProductForMatch,
} from "@/lib/flyerAnalysis";

const db = supabase as any;

type FlyerRow = {
  id: string;
  retailer: string;
  title?: string | null;
  valid_from: string | null;
  valid_to: string | null;
};

type FlyerItemRow = {
  id: string;
  flyer_id: string;
  product_id: string | null;
  raw_name: string;
  brand?: string | null;
  package_quantity?: number | null;
  package_unit?: string | null;
  advertised_price: number | string;
  normalized_price: number | string | null;
  base_unit?: "kg" | "l" | "un" | null;
  club_price?: boolean | null;
  club_advertised_price?: number | string | null;
  source_page?: number | null;
};

type AliasRow = {
  product_id: string;
  normalized_alias: string;
  retailer?: string | null;
};

const verdictOrder = {
  exceptional: 0,
  good: 1,
  normal: 2,
  high: 3,
  unknown: 4,
} as const;

const verdictUi = {
  exceptional: {
    label: "Preço raro",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
    Icon: Sparkles,
  },
  good: {
    label: "Vale a pena",
    className: "border-green-500/35 bg-green-500/10 text-green-500",
    Icon: TrendingDown,
  },
  normal: {
    label: "Na faixa",
    className: "border-amber-500/35 bg-amber-500/10 text-amber-500",
    Icon: BadgeCheck,
  },
  high: {
    label: "Já esteve melhor",
    className: "border-red-500/35 bg-red-500/10 text-red-500",
    Icon: TrendingUp,
  },
  unknown: {
    label: "Sem referência",
    className: "border-border bg-muted/60 text-muted-foreground",
    Icon: History,
  },
} as const;

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateBr(value?: string | null) {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function searchTokens(value: string) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (["refri", "refr"].includes(token)) return "refrigerante";
      if (["qj", "qjo"].includes(token)) return "queijo";
      if (["muss", "mussar", "mozzarella"].includes(token)) return "mussarela";
      return token;
    });
}

function matchesSearch(value: string, query: string) {
  const wanted = searchTokens(query);
  if (!wanted.length) return true;
  const source = searchTokens(value);
  return wanted.every((needle) =>
    source.some((token) =>
      token.includes(needle) ||
      needle.includes(token) ||
      (needle.length >= 4 && token.length >= 3 && needle.startsWith(token)),
    ),
  );
}

const identityStop = new Set([
  "de", "da", "do", "das", "dos", "em", "po", "lt", "lata", "latas",
  "tradicional", "tipo", "tipos", "sabor", "sabores", "embalagem",
  "pacote", "pct", "un", "und", "unid", "kg", "g", "ml", "l",
]);

function offerIdentityTokens(value: string) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) =>
      token &&
      !identityStop.has(token) &&
      !/^\d+(?:\.\d+)?$/.test(token),
    );
}

function comparableOfferIdentity(current: FlyerItemRow, previous: FlyerItemRow) {
  if (
    current.base_unit &&
    previous.base_unit &&
    current.base_unit !== previous.base_unit
  ) {
    return false;
  }

  const a = offerIdentityTokens(current.raw_name);
  const b = offerIdentityTokens(previous.raw_name);
  if (!a.length || !b.length) return false;

  const bSet = new Set(b);
  const common = [...new Set(a)].filter((token) => bSet.has(token));
  if (common.length < 2) return false;

  // Prevent same-brand but different product families from contaminating history.
  // Example: "Achocolatado Nescau" must not compare with "Cereal Nescau".
  if (a[0] !== b[0] && common.length < 3) return false;

  return true;
}

function candidateFromItem(item: FlyerItemRow): FlyerCandidate {
  const packageInfo =
    item.package_quantity && item.package_unit
      ? inferPackage(`${item.package_quantity}${item.package_unit}`)
      : inferPackage(item.raw_name);
  const advertisedPrice = Number(item.advertised_price) || 0;
  const normalized =
    Number(item.normalized_price) > 0
      ? {
          normalizedPrice: Number(item.normalized_price),
          baseUnit: (item.base_unit || packageInfo?.baseUnit || "un") as "kg" | "l" | "un",
        }
      : normalizedUnitPrice(advertisedPrice, packageInfo);

  return {
    rawName: item.raw_name,
    brand: item.brand ?? null,
    price: advertisedPrice,
    packageInfo,
    normalizedPrice: normalized.normalizedPrice,
    baseUnit: normalized.baseUnit,
    clubPrice: Boolean(item.club_price),
    sourcePage: Number(item.source_page) || 1,
  };
}

export default function OffersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const today = useMemo(() => localDateKey(), []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["live-market-offers", user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const [
        { data: flyers, error: flyersError },
        { data: items, error: itemsError },
        { data: products, error: productsError },
        { data: aliases, error: aliasesError },
      ] = await Promise.all([
        db
          .from("flyers")
          .select("id,retailer,title,valid_from,valid_to")
          .order("created_at", { ascending: false }),
        db
          .from("flyer_items")
          .select(
            "id,flyer_id,product_id,raw_name,brand,package_quantity,package_unit,advertised_price,normalized_price,base_unit,club_price,club_advertised_price,source_page",
          )
          .order("created_at", { ascending: false })
          .limit(5000),
        db
          .from("products")
          .select(
            "id,name,category,brand,package_size,unit,image_url,image_source,prices(price,date,supermarket)",
          )
          .order("name"),
        db
          .from("product_aliases")
          .select("product_id,normalized_alias,retailer"),
      ]);

      if (flyersError) throw flyersError;
      if (itemsError) throw itemsError;
      if (productsError) throw productsError;
      if (aliasesError) throw aliasesError;

      return {
        flyers: (flyers ?? []) as FlyerRow[],
        items: (items ?? []) as FlyerItemRow[],
        products: (products ?? []) as ProductForMatch[],
        aliases: (aliases ?? []) as AliasRow[],
      };
    },
  });

  const analyzed = useMemo(() => {
    if (!data) return [];

    const flyerById = new Map(data.flyers.map((flyer) => [flyer.id, flyer]));
    const activeFlyers = data.flyers.filter(
      (flyer) =>
        !!flyer.valid_from &&
        !!flyer.valid_to &&
        flyer.valid_from <= today &&
        flyer.valid_to >= today,
    );
    const activeIds = new Set(activeFlyers.map((flyer) => flyer.id));
    const historicalIds = new Set(
      data.flyers
        .filter((flyer) => !!flyer.valid_to && flyer.valid_to < today)
        .map((flyer) => flyer.id),
    );
    const productMap = new Map(data.products.map((product) => [product.id, product]));

    return data.items
      .filter((item) => activeIds.has(item.flyer_id))
      .map((item) => {
        const flyer = flyerById.get(item.flyer_id);
        const candidate = candidateFromItem(item);

        let productId = item.product_id;
        if (!productId) {
          productId = matchFlyerItem(
            candidate,
            data.products,
            data.aliases,
            flyer?.retailer,
          ).productId;
        }
        const product = productId ? productMap.get(productId) ?? null : null;

        const previousAdvertised = data.items.filter((previous) => {
          if (!historicalIds.has(previous.flyer_id)) return false;
          if (productId && previous.product_id === productId) return true;
          return comparableOfferIdentity(item, previous);
        });

        const verdict = evaluateFlyerOffer(
          candidate,
          product,
          previousAdvertised,
        );

        return {
          item,
          flyer,
          product,
          productId,
          candidate,
          verdict,
        };
      })
      .filter((entry) =>
        matchesSearch(
          `${entry.item.raw_name} ${entry.product?.name ?? ""} ${entry.product?.brand ?? ""}`,
          search,
        ),
      )
      .sort((a, b) => {
        const verdictDiff =
          verdictOrder[a.verdict.key] - verdictOrder[b.verdict.key];
        if (verdictDiff) return verdictDiff;

        const aDelta = a.verdict.deltaPct ?? 999;
        const bDelta = b.verdict.deltaPct ?? 999;
        if (aDelta !== bDelta) return aDelta - bDelta;

        if (a.candidate.baseUnit === b.candidate.baseUnit) {
          return a.candidate.normalizedPrice - b.candidate.normalizedPrice;
        }
        return a.candidate.price - b.candidate.price;
      });
  }, [data, search, today]);

  const activeFlyerCount = useMemo(() => {
    if (!data) return 0;
    return data.flyers.filter(
      (flyer) =>
        !!flyer.valid_from &&
        !!flyer.valid_to &&
        flyer.valid_from <= today &&
        flyer.valid_to >= today,
    ).length;
  }, [data, today]);

  const allActiveOfferCount = useMemo(() => {
    if (!data) return 0;
    const activeIds = new Set(
      data.flyers
        .filter(
          (flyer) =>
            !!flyer.valid_from &&
            !!flyer.valid_to &&
            flyer.valid_from <= today &&
            flyer.valid_to >= today,
        )
        .map((flyer) => flyer.id),
    );
    return data.items.filter((item) => activeIds.has(item.flyer_id)).length;
  }, [data, today]);

  return (
    <div className="page-container mx-auto w-full max-w-3xl">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
              Preço 360 · Ofertas
            </p>
            <h1 className="mt-1 text-[clamp(1.55rem,6vw,2.05rem)] font-extrabold leading-tight tracking-tight">
              Onde vale a pena comprar agora?
            </h1>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Consulte ofertas vigentes e compare com o que você já pagou e com tabloides anteriores.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => navigate("/radar")}
          >
            <Radar className="h-4 w-4" />
            Radar 360
          </Button>
        </div>
      </header>

      <Button
        type="button"
        variant="outline"
        className="mb-3 h-11 w-full justify-between border-primary/25 bg-primary/5"
        onClick={() => navigate("/offers/basket")}
      >
        <span className="flex items-center gap-2">
          <ShoppingBasket className="h-4 w-4 text-primary" />
          <span className="text-left">
            <span className="block text-sm font-bold">Cesta 360</span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              Compare onde sua lista inteira sai mais em conta
            </span>
          </span>
        </span>
        <ChevronRight className="h-4 w-4 text-primary" />
      </Button>

      <div className="relative mb-2">
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="h-12 pl-10 text-base"
          placeholder="Busque Nescau, café, leite, carne..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full border bg-card px-2.5 py-1">
          {activeFlyerCount} tabloide(s) vigente(s)
        </span>
        <span className="rounded-full border bg-card px-2.5 py-1">
          {allActiveOfferCount} ofertas disponíveis hoje
        </span>
      </div>

      {isLoading && (
        <Card className="border-dashed">
          <CardContent className="p-7 text-center text-sm text-muted-foreground">
            Consultando as ofertas vigentes…
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5">
            <p className="font-bold text-destructive">Não consegui consultar as ofertas</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Tente novamente."}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && activeFlyerCount === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-7 text-center">
            <Clock3 className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-3 font-bold">Nenhum tabloide vigente hoje</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Importe os tabloides atuais no Radar 360 para liberar a consulta.
            </p>
            <Button className="mt-4" onClick={() => navigate("/radar")}>
              Abrir Radar 360
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && activeFlyerCount > 0 && analyzed.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-7 text-center">
            <Tags className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-3 font-bold">
              {search ? `Nenhuma oferta vigente para “${search}”` : "Nenhuma oferta disponível"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search
                ? "Tente parte do nome, a marca ou uma descrição mais curta."
                : "Os tabloides vigentes ainda não possuem ofertas consultáveis."}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && analyzed.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {search ? "Resultado da busca" : "Melhores oportunidades vigentes"}
              </p>
              <p className="text-sm font-bold">
                {analyzed.length} oferta(s) encontrada(s)
              </p>
            </div>
            {search && analyzed[0] && (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
                Melhor oportunidade primeiro
              </span>
            )}
          </div>

          {analyzed.slice(0, search ? 100 : 24).map((entry, index) => {
            const { item, flyer, candidate, verdict, productId } = entry;
            const ui = verdictUi[verdict.key];
            const VerdictIcon = ui.Icon;
            const clubPrice = Number(item.club_advertised_price) || null;
            const isTopResult = Boolean(search) && index === 0;

            return (
              <Card
                key={item.id}
                className={isTopResult ? "border-primary/40 shadow-sm" : ""}
              >
                <CardContent className="p-4">
                  {isTopResult && (
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.13em] text-primary">
                      Melhor oportunidade encontrada
                    </p>
                  )}

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-bold leading-snug">{item.raw_name}</h2>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Store className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate font-semibold text-foreground/80">
                          {flyer?.retailer ?? "Supermercado"}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-extrabold">{brl(candidate.price)}</p>
                      {candidate.baseUnit !== "un" && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatNormalizedPrice(candidate.normalizedPrice, candidate.baseUnit)}
                        </p>
                      )}
                      {clubPrice && (
                        <p className="mt-0.5 text-[11px] font-bold text-primary">
                          Clube {brl(clubPrice)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${ui.className}`}
                    >
                      <VerdictIcon className="h-3.5 w-3.5" />
                      {ui.label}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      até {dateBr(flyer?.valid_to)}
                    </span>
                  </div>

                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {verdict.message}
                  </p>

                  {verdict.referencePrice && (
                    <div className="mt-3 rounded-xl bg-muted/55 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Referência histórica
                      </p>
                      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-extrabold">
                          {formatNormalizedPrice(
                            verdict.referencePrice,
                            candidate.baseUnit,
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {verdict.purchaseCount} pago(s) + {verdict.advertisedCount} oferta(s) anterior(es)
                        </p>
                      </div>
                    </div>
                  )}

                  {productId && (
                    <button
                      type="button"
                      onClick={() => navigate(`/product/${productId}`)}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                    >
                      Ver histórico completo
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
