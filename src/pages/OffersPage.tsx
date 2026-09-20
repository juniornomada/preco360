import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ProductVisual from "@/components/ProductVisual";
import {
  BadgeCheck,
  ChevronRight,
  Clock3,
  History,
  Search,
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
  image_url?: string | null;
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

const searchStopWords = new Set([
  "de", "da", "do", "das", "dos", "em",
]);

function searchTokens(value: string) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (["refri", "refr"].includes(token)) return "refrigerante";
      if (["qj", "qjo"].includes(token)) return "queijo";
      if (["muss", "mussar", "mozzarella"].includes(token)) return "mussarela";
      return token;
    })
    .filter((token) => !searchStopWords.has(token));
}

type OfferFamily =
  | "powder"
  | "drink"
  | "cereal"
  | "capsule"
  | "refrigerante"
  | "juice"
  | "milkLiquid"
  | "milkPowder"
  | "milkCream"
  | "milkCondensed"
  | "milkFermented"
  | "milkCoconut"
  | "milkSweet"
  | "tomatoFresh"
  | "tomatoSauce"
  | "tomatoExtract"
  | "tomatoPassata"
  | "tomatoPeeled"
  | "cornFresh"
  | "cornGreen"
  | "cornPopcorn"
  | "coffeeGround"
  | "coffeeBeans"
  | "coffeeSoluble"
  | "coffeeCapsule"
  | "cake"
  | "other";

type SearchFamilyIntent = OfferFamily | "milk" | "corn" | "coffee";

function hasAny(tokens: Set<string>, values: string[]) {
  return values.some((value) => tokens.has(value));
}

function queryOfferFamily(query: string): SearchFamilyIntent | null {
  const tokens = new Set(searchTokens(query));
  const hasMilk = hasAny(tokens, ["leite", "leites"]);
  const hasTomato = hasAny(tokens, ["tomate", "tomates"]);
  const hasCorn = hasAny(tokens, ["milho", "milhos"]);
  const hasCoffee = hasAny(tokens, ["cafe", "cafes"]);

  if (hasMilk) {
    if (hasAny(tokens, ["bolo", "bolos"])) return "cake";
    if (hasAny(tokens, ["creme", "cremes"])) return "milkCream";
    if (hasAny(tokens, ["condensado", "condensados"])) return "milkCondensed";
    if (hasAny(tokens, ["fermentado", "fermentados"])) return "milkFermented";
    if (tokens.has("coco")) return "milkCoconut";
    if (hasAny(tokens, ["doce", "doces"])) return "milkSweet";
    if (tokens.has("po")) return "milkPowder";
    return "milk";
  }

  if (hasTomato) {
    // When tomato is only a sauce/ingredient of another primary product,
    // keep literal search behavior instead of treating it as tomato itself.
    if (hasAny(tokens, ["sardinha", "sardinhas", "atum", "pizza", "pizzas"])) {
      return null;
    }
    if (hasAny(tokens, ["molho", "molhos"])) return "tomatoSauce";
    if (hasAny(tokens, ["extrato", "extratos"])) return "tomatoExtract";
    if (hasAny(tokens, ["passata", "passatas"])) return "tomatoPassata";
    if (hasAny(tokens, ["pelado", "pelados", "pelada", "peladas"])) {
      return "tomatoPeeled";
    }
    return "tomatoFresh";
  }

  if (hasCorn) {
    if (hasAny(tokens, ["bolo", "bolos"])) return "cake";
    if (hasAny(tokens, ["suco", "sucos"])) return "juice";

    // These are derived products where milho is an ingredient/material,
    // not the product family the user means by a plain "milho" search.
    if (
      hasAny(tokens, [
        "curau",
        "curaus",
        "amido",
        "amidos",
        "farofa",
        "farofas",
      ])
    ) {
      return null;
    }

    if (hasAny(tokens, ["pipoca", "pipocas"])) return "cornPopcorn";
    if (hasAny(tokens, ["verde", "verdes", "conserva", "vapor"])) {
      return "cornGreen";
    }
    return "corn";
  }

  if (hasCoffee) {
    // Coffee used as flavor/ingredient keeps the more specific primary family.
    if (hasAny(tokens, ["bala", "balas", "bombom", "bombons"])) return null;
    if (hasAny(tokens, ["bebida", "bebidas"])) return "drink";
    if (hasAny(tokens, ["capsula", "capsulas"])) return "coffeeCapsule";
    if (hasAny(tokens, ["soluvel", "soluveis"])) return "coffeeSoluble";
    if (hasAny(tokens, ["grao", "graos"])) return "coffeeBeans";
    if (tokens.has("po")) return "coffeeGround";
    return "coffee";
  }

  if (hasAny(tokens, ["bebida", "bebidas"])) return "drink";
  if (
    tokens.has("po") ||
    hasAny(tokens, [
      "achocolatado",
      "achocolatada",
      "achocolatados",
      "achocolatadas",
    ])
  ) {
    return "powder";
  }
  if (hasAny(tokens, ["cereal", "cereais"])) return "cereal";
  if (hasAny(tokens, ["capsula", "capsulas"])) return "capsule";
  if (hasAny(tokens, ["refrigerante", "refrigerantes"])) {
    return "refrigerante";
  }
  if (hasAny(tokens, ["suco", "sucos"])) return "juice";

  return null;
}

function inferOfferFamily(
  item: FlyerItemRow,
  product: ProductForMatch | null,
): OfferFamily {
  const raw = normalizeSearchText(item.raw_name);
  const text = normalizeSearchText(
    `${item.raw_name} ${item.brand ?? ""} ${product?.name ?? ""} ${product?.category ?? ""}`,
  );
  const tokens = new Set(searchTokens(text));
  const packageUnit = normalizeSearchText(item.package_unit ?? "");
  const baseUnit = item.base_unit ?? null;
  const isVolume =
    baseUnit === "l" || packageUnit === "ml" || packageUnit === "l";
  const isWeight =
    baseUnit === "kg" || packageUnit === "g" || packageUnit === "kg";

  // Product-head rules: the beginning of the name is more reliable than a
  // keyword appearing later as flavor, ingredient or accompaniment.
  if (/^bolos?\b/.test(raw)) return "cake";

  if (/^(?:mistura de )?creme de leite\b/.test(raw)) return "milkCream";
  if (/^leite condensado\b/.test(raw)) return "milkCondensed";
  if (/^leite fermentado\b/.test(raw)) return "milkFermented";
  if (/^leite de coco\b/.test(raw)) return "milkCoconut";
  if (/^doce de leite\b/.test(raw)) return "milkSweet";

  if (/^leite\b/.test(raw)) {
    if (/\bpo\b/.test(raw)) return "milkPowder";
    if (isVolume) return "milkLiquid";
    if (isWeight) return "milkPowder";
    return "milkLiquid";
  }

  if (/^molho (?:de )?tomate\b/.test(raw)) return "tomatoSauce";
  if (/^extrato (?:de )?tomate\b/.test(raw)) return "tomatoExtract";
  if (/^passata\b/.test(raw) && /\btomate\b/.test(raw)) {
    return "tomatoPassata";
  }
  if (/^tomates?\b/.test(raw)) {
    if (/\bpelad[oa]s?\b/.test(raw)) return "tomatoPeeled";
    return "tomatoFresh";
  }

  if (/^milho\b/.test(raw)) {
    if (/\bpipoca\b/.test(raw)) return "cornPopcorn";
    if (/\bverde\b/.test(raw) || /\bconserva\b/.test(raw)) {
      return "cornGreen";
    }
    return "cornFresh";
  }

  // Coffee is only treated as coffee when coffee itself is the product head.
  // "Bala de café" and "bebida ... café" therefore stay in their own families.
  if (/^(?:caps|capsula|capsulas)\b/.test(raw) && /\bcafe\b/.test(raw)) {
    return "coffeeCapsule";
  }
  if (/^cafe\b/.test(raw)) {
    if (isVolume) return "drink";
    if (/\bsoluvel\b/.test(raw)) return "coffeeSoluble";
    if (/\bgraos?\b/.test(raw)) return "coffeeBeans";
    return "coffeeGround";
  }

  if (hasAny(tokens, ["bebida", "bebidas"])) return "drink";
  if (hasAny(tokens, ["cereal", "cereais"])) return "cereal";
  if (hasAny(tokens, ["capsula", "capsulas"])) return "capsule";
  if (hasAny(tokens, ["refrigerante", "refrigerantes"])) {
    return "refrigerante";
  }
  if (hasAny(tokens, ["suco", "sucos"])) return "juice";

  if (tokens.has("po")) return "powder";

  // OCR/encartes frequentemente omitem "em pó" do nome, como
  // "Achocolatado Nescau 350g".
  const isChocolateDrinkPowderName = hasAny(tokens, [
    "achocolatado",
    "achocolatada",
    "achocolatados",
    "achocolatadas",
  ]);
  if (isChocolateDrinkPowderName && isWeight) return "powder";

  return "other";
}

function familyLabel(family: OfferFamily) {
  if (family === "powder") return "Achocolatado em pó";
  if (family === "drink") return "Bebida";
  if (family === "cereal") return "Cereal";
  if (family === "capsule") return "Cápsulas";
  if (family === "refrigerante") return "Refrigerante";
  if (family === "juice") return "Suco";
  if (family === "milkLiquid") return "Leite";
  if (family === "milkPowder") return "Leite em pó";
  if (family === "milkCream") return "Creme de leite";
  if (family === "milkCondensed") return "Leite condensado";
  if (family === "milkFermented") return "Leite fermentado";
  if (family === "milkCoconut") return "Leite de coco";
  if (family === "milkSweet") return "Doce de leite";
  if (family === "tomatoFresh") return "Tomate";
  if (family === "tomatoSauce") return "Molho de tomate";
  if (family === "tomatoExtract") return "Extrato de tomate";
  if (family === "tomatoPassata") return "Passata";
  if (family === "tomatoPeeled") return "Tomate pelado";
  if (family === "cornFresh") return "Milho";
  if (family === "cornGreen") return "Milho verde";
  if (family === "cornPopcorn") return "Milho para pipoca";
  if (family === "coffeeGround") return "Café";
  if (family === "coffeeBeans") return "Café em grão";
  if (family === "coffeeSoluble") return "Café solúvel";
  if (family === "coffeeCapsule") return "Café em cápsula";
  if (family === "cake") return "Bolo";
  return "Produto";
}

function familySemanticTokens(intent: SearchFamilyIntent | null) {
  const result = new Set<string>();
  const add = (...tokens: string[]) => tokens.forEach((token) => result.add(token));
  if (!intent) return result;

  if (intent === "milk" || intent === "milkLiquid") add("leite", "leites");
  if (intent === "milkPowder") add("leite", "leites", "po");
  if (intent === "milkCream") add("creme", "cremes", "leite", "leites");
  if (intent === "milkCondensed") {
    add("leite", "leites", "condensado", "condensados");
  }
  if (intent === "milkFermented") {
    add("leite", "leites", "fermentado", "fermentados");
  }
  if (intent === "milkCoconut") add("leite", "leites", "coco");
  if (intent === "milkSweet") add("doce", "doces", "leite", "leites");

  if (intent === "tomatoFresh") add("tomate", "tomates");
  if (intent === "tomatoSauce") add("molho", "molhos", "tomate", "tomates");
  if (intent === "tomatoExtract") {
    add("extrato", "extratos", "tomate", "tomates");
  }
  if (intent === "tomatoPassata") add("passata", "passatas", "tomate", "tomates");
  if (intent === "tomatoPeeled") {
    add("tomate", "tomates", "pelado", "pelados", "pelada", "peladas");
  }

  if (intent === "corn") add("milho", "milhos");
  if (intent === "cornFresh") add("milho", "milhos");
  if (intent === "cornGreen") add("milho", "milhos", "verde", "verdes");
  if (intent === "cornPopcorn") add("milho", "milhos", "pipoca", "pipocas");

  if (intent === "coffee") add("cafe", "cafes");
  if (intent === "coffeeGround") add("cafe", "cafes", "po");
  if (intent === "coffeeBeans") add("cafe", "cafes", "grao", "graos");
  if (intent === "coffeeSoluble") add("cafe", "cafes", "soluvel", "soluveis");
  if (intent === "coffeeCapsule") {
    add("cafe", "cafes", "caps", "capsula", "capsulas");
  }

  if (intent === "powder") {
    add(
      "po",
      "achocolatado",
      "achocolatada",
      "achocolatados",
      "achocolatadas",
    );
  }
  if (intent === "drink") add("bebida", "bebidas", "lactea", "lacteas");
  if (intent === "cereal") add("cereal", "cereais");
  if (intent === "capsule") add("caps", "capsula", "capsulas");
  if (intent === "refrigerante") add("refrigerante", "refrigerantes");
  if (intent === "juice") add("suco", "sucos");
  if (intent === "cake") add("bolo", "bolos");

  return result;
}

function familyMatchesIntent(family: OfferFamily, intent: SearchFamilyIntent | null) {
  if (!intent) return true;
  if (intent === "milk") {
    return family === "milkLiquid" || family === "milkPowder";
  }
  if (intent === "corn") {
    return (
      family === "cornFresh" ||
      family === "cornGreen" ||
      family === "cornPopcorn"
    );
  }
  if (intent === "coffee") {
    return (
      family === "coffeeGround" ||
      family === "coffeeBeans" ||
      family === "coffeeSoluble" ||
      family === "coffeeCapsule"
    );
  }
  return family === intent;
}

function matchesSearch(
  value: string,
  query: string,
  family: OfferFamily,
) {
  const queryFamily = queryOfferFamily(query);
  if (!familyMatchesIntent(family, queryFamily)) return false;

  // Family words act as semantic filters, while brand/model words remain
  // literal requirements. This prevents ingredient/flavor matches without
  // making OCR wording variations disappear from valid results.
  const semanticTokens = familySemanticTokens(queryFamily);
  const wanted = searchTokens(query).filter(
    (token) => !semanticTokens.has(token),
  );
  if (!wanted.length) return true;

  const source = searchTokens(value);
  return wanted.every((needle) =>
    source.some((token) =>
      token === needle ||
      token.includes(needle) ||
      (needle.length >= 4 && token.length >= 3 && needle.startsWith(token)),
    ),
  );
}

function searchRelevance(
  entry: {
    item: FlyerItemRow;
    product: ProductForMatch | null;
    searchText: string;
  },
  query: string,
) {
  const normalizedQuery = normalizeSearchText(query).trim();
  if (!normalizedQuery) return 0;

  const itemBrand = normalizeSearchText(entry.item.brand ?? "").trim();
  const productBrand = normalizeSearchText(entry.product?.brand ?? "").trim();
  const rawName = normalizeSearchText(entry.item.raw_name);
  const productName = normalizeSearchText(entry.product?.name ?? "");

  if (itemBrand === normalizedQuery || productBrand === normalizedQuery) return 100;
  if (rawName.split(/\s+/).includes(normalizedQuery)) return 90;
  if (productName.split(/\s+/).includes(normalizedQuery)) return 85;
  if (rawName.includes(normalizedQuery)) return 80;
  if (productName.includes(normalizedQuery)) return 75;
  if (itemBrand.includes(normalizedQuery) || productBrand.includes(normalizedQuery)) return 70;
  return 50;
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

function validClubPrice(item: FlyerItemRow) {
  const regular = Number(item.advertised_price);
  const club = Number(item.club_advertised_price);
  return Number.isFinite(club) &&
    club > 0 &&
    (!Number.isFinite(regular) || regular <= 0 || club <= regular)
    ? club
    : null;
}

function candidateFromItem(item: FlyerItemRow): FlyerCandidate {
  const packageInfo =
    item.package_quantity && item.package_unit
      ? inferPackage(`${item.package_quantity}${item.package_unit}`)
      : inferPackage(item.raw_name);

  const regularPrice = Number(item.advertised_price) || 0;
  const clubPrice = validClubPrice(item);
  const effectivePrice = clubPrice ?? regularPrice;
  const normalized = normalizedUnitPrice(effectivePrice, packageInfo);

  return {
    rawName: item.raw_name,
    brand: item.brand ?? null,
    price: effectivePrice,
    packageInfo,
    normalizedPrice: normalized.normalizedPrice,
    baseUnit: (item.base_unit || normalized.baseUnit) as "kg" | "l" | "un",
    clubPrice: clubPrice !== null,
    sourcePage: Number(item.source_page) || 1,
  };
}

export default function OffersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim();
  const hasSearch = normalizedSearch.length >= 2;
  const today = useMemo(() => localDateKey(), []);

  const {
    data: flyers = [],
    isLoading: loadingFlyers,
    error: flyersError,
  } = useQuery({
    queryKey: ["live-market-flyers", user?.id, today],
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await db
        .from("flyers")
        .select("id,retailer,title,valid_from,valid_to")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as FlyerRow[];
    },
  });

  const activeFlyers = useMemo(
    () =>
      flyers.filter(
        (flyer) =>
          !!flyer.valid_from &&
          !!flyer.valid_to &&
          flyer.valid_from <= today &&
          flyer.valid_to >= today,
      ),
    [flyers, today],
  );

  const activeFlyerIds = useMemo(
    () => activeFlyers.map((flyer) => flyer.id),
    [activeFlyers],
  );

  const { data: activeOfferCount = 0 } = useQuery({
    queryKey: ["live-market-offer-count", user?.id, today, activeFlyerIds],
    enabled: !!user && activeFlyerIds.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { count, error } = await db
        .from("flyer_items")
        .select("id", { count: "exact", head: true })
        .in("flyer_id", activeFlyerIds);

      if (error) throw error;
      return count ?? 0;
    },
  });

  const {
    data: searchData,
    isLoading: loadingSearchData,
    error: searchDataError,
  } = useQuery({
    queryKey: ["live-market-offers-search-base", user?.id, today],
    enabled: !!user && hasSearch,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [
        { data: items, error: itemsError },
        { data: products, error: productsError },
        { data: aliases, error: aliasesError },
      ] = await Promise.all([
        db
          .from("flyer_items")
          .select(
            "id,flyer_id,product_id,raw_name,brand,package_quantity,package_unit,advertised_price,normalized_price,base_unit,club_price,club_advertised_price,source_page,image_url",
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

      if (itemsError) throw itemsError;
      if (productsError) throw productsError;
      if (aliasesError) throw aliasesError;

      return {
        items: (items ?? []) as FlyerItemRow[],
        products: (products ?? []) as ProductForMatch[],
        aliases: (aliases ?? []) as AliasRow[],
      };
    },
  });

  const isLoading = loadingFlyers || (hasSearch && loadingSearchData);
  const error = flyersError || searchDataError;

  const preparedOffers = useMemo(() => {
    if (!hasSearch || !searchData) return [];

    const flyerById = new Map(flyers.map((flyer) => [flyer.id, flyer]));
    const activeIds = new Set(activeFlyerIds);
    const historicalIds = new Set(
      flyers
        .filter((flyer) => !!flyer.valid_to && flyer.valid_to < today)
        .map((flyer) => flyer.id),
    );
    const productMap = new Map(
      searchData.products.map((product) => [product.id, product]),
    );

    const historicalItems = searchData.items.filter((item) =>
      historicalIds.has(item.flyer_id),
    );
    const historyByProduct = new Map<string, FlyerItemRow[]>();
    for (const previous of historicalItems) {
      if (!previous.product_id) continue;
      const rows = historyByProduct.get(previous.product_id) ?? [];
      rows.push(previous);
      historyByProduct.set(previous.product_id, rows);
    }

    return searchData.items
      .filter((item) => activeIds.has(item.flyer_id))
      .map((item) => {
        const flyer = flyerById.get(item.flyer_id);
        const candidate = candidateFromItem(item);

        let productId = item.product_id;
        if (!productId) {
          productId = matchFlyerItem(
            candidate,
            searchData.products,
            searchData.aliases,
            flyer?.retailer,
          ).productId;
        }
        const product = productId ? productMap.get(productId) ?? null : null;

        const linkedHistory = productId
          ? historyByProduct.get(productId) ?? []
          : [];

        const previousAdvertised = linkedHistory.length
          ? linkedHistory
          : historicalItems.filter((previous) =>
              comparableOfferIdentity(item, previous),
            );

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
          family: inferOfferFamily(item, product),
          searchText: `${item.raw_name} ${item.brand ?? ""} ${product?.name ?? ""} ${product?.brand ?? ""} ${product?.category ?? ""}`,
        };
      })
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
  }, [hasSearch, searchData, flyers, activeFlyerIds, today]);

  const analyzed = useMemo(() => {
    if (!hasSearch || !preparedOffers.length) return [];

    const matches = preparedOffers.filter((entry) =>
      matchesSearch(entry.searchText, normalizedSearch, entry.family),
    );

    // Build stable semantic groups first. A pairwise comparator alone is not
    // enough here because an unrelated item between two comparable offers can
    // make Array.sort non-transitive (e.g. Nescau powder -> Nescau drink ->
    // Nescau powder). Grouping guarantees every comparable family is sorted
    // internally by its real effective unit price.
    const groups: typeof matches[] = [];

    for (const entry of matches) {
      const group = groups.find((candidateGroup) =>
        candidateGroup.some((member) =>
          comparableOfferIdentity(member.item, entry.item),
        ),
      );

      if (group) group.push(entry);
      else groups.push([entry]);
    }

    const sortedGroups = groups
      .map((group, originalIndex) => {
        const sorted = [...group].sort((a, b) => {
          const relevanceDiff =
            searchRelevance(b, normalizedSearch) -
            searchRelevance(a, normalizedSearch);
          if (relevanceDiff) return relevanceDiff;

          if (a.candidate.baseUnit === b.candidate.baseUnit) {
            const priceDiff =
              a.candidate.normalizedPrice - b.candidate.normalizedPrice;
            if (Math.abs(priceDiff) > 0.0001) return priceDiff;
          }

          const packagePriceDiff = a.candidate.price - b.candidate.price;
          if (Math.abs(packagePriceDiff) > 0.0001) return packagePriceDiff;

          const verdictDiff =
            verdictOrder[a.verdict.key] - verdictOrder[b.verdict.key];
          if (verdictDiff) return verdictDiff;

          return 0;
        });

        return {
          sorted,
          originalIndex,
          relevance: Math.max(
            ...group.map((entry) =>
              searchRelevance(entry, normalizedSearch),
            ),
          ),
          verdict: Math.min(
            ...group.map((entry) => verdictOrder[entry.verdict.key]),
          ),
        };
      })
      .sort((a, b) => {
        if (a.relevance !== b.relevance) return b.relevance - a.relevance;
        if (a.verdict !== b.verdict) return a.verdict - b.verdict;
        return a.originalIndex - b.originalIndex;
      });

    return sortedGroups.flatMap((group) => group.sorted);
  }, [preparedOffers, hasSearch, normalizedSearch, search]);

  const explicitSearchFamily = useMemo(
    () => queryOfferFamily(normalizedSearch),
    [normalizedSearch],
  );
  const isBroadFamilySearch =
    explicitSearchFamily === null ||
    explicitSearchFamily === "milk" ||
    explicitSearchFamily === "corn" ||
    explicitSearchFamily === "coffee";

  const bestOfferByFamily = useMemo(() => {
    const best = new Map<OfferFamily, string>();

    for (const entry of analyzed) {
      const currentId = best.get(entry.family);
      if (!currentId) {
        best.set(entry.family, entry.item.id);
        continue;
      }

      const current = analyzed.find((candidate) => candidate.item.id === currentId);
      if (!current) {
        best.set(entry.family, entry.item.id);
        continue;
      }

      const currentPrice = current.candidate.normalizedPrice;
      const candidatePrice = entry.candidate.normalizedPrice;
      if (candidatePrice < currentPrice - 0.0001) {
        best.set(entry.family, entry.item.id);
      } else if (
        Math.abs(candidatePrice - currentPrice) <= 0.0001 &&
        entry.candidate.price < current.candidate.price
      ) {
        best.set(entry.family, entry.item.id);
      }
    }

    return best;
  }, [analyzed]);

  const activeFlyerCount = activeFlyers.length;
  const allActiveOfferCount = activeOfferCount;

  return (
    <div className="page-container !pb-40 mx-auto w-full max-w-3xl">
      <header className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          Preço 360 · Ofertas
        </p>
        <h1 className="mt-1 text-[clamp(1.55rem,6vw,2.05rem)] font-extrabold leading-tight tracking-tight">
          Onde vale a pena comprar agora?
        </h1>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Consulte ofertas vigentes e compare com o que você já pagou e com tabloides anteriores.
        </p>
      </header>

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

      {hasSearch && isLoading && (
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

      {!isLoading &&
        !error &&
        activeFlyerCount > 0 &&
        search.trim().length === 1 && (
          <Card className="border-dashed">
            <CardContent className="p-5 text-center">
              <Search className="mx-auto h-7 w-7 text-primary" />
              <p className="mt-2 font-bold">Digite mais uma letra</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A busca começa com 2 caracteres para manter a digitação rápida no celular.
              </p>
            </CardContent>
          </Card>
        )}

      {!isLoading &&
        !error &&
        activeFlyerCount > 0 &&
        search.trim().length !== 1 &&
        analyzed.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="p-7 text-center">
              <Tags className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 font-bold">
                {hasSearch
                  ? `Nenhuma oferta vigente para “${normalizedSearch}”`
                  : "Busque um produto"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasSearch
                  ? "Tente parte do nome, a marca ou uma descrição mais curta."
                  : "Digite pelo menos 2 letras para consultar somente as ofertas relevantes."}
              </p>
            </CardContent>
          </Card>
        )}

      {!isLoading && !error && analyzed.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {hasSearch ? "Resultado da busca" : "Melhores oportunidades vigentes"}
              </p>
              <p className="text-sm font-bold">
                {analyzed.length} oferta(s) encontrada(s)
              </p>
            </div>
            {hasSearch && analyzed[0] && (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
                {isBroadFamilySearch
                  ? "Melhor por tipo de produto"
                  : "Melhor oportunidade primeiro"}
              </span>
            )}
          </div>

          {analyzed.slice(0, hasSearch ? 30 : 12).map((entry, index) => {
            const { item, flyer, candidate, verdict, productId } = entry;
            const ui = verdictUi[verdict.key];
            const VerdictIcon = ui.Icon;
            const regularPrice = Number(item.advertised_price) || 0;
            const clubPrice = validClubPrice(item);
            const regularPackage =
              item.package_quantity && item.package_unit
                ? inferPackage(`${item.package_quantity}${item.package_unit}`)
                : inferPackage(item.raw_name);
            const regularNormalized = normalizedUnitPrice(
              regularPrice,
              regularPackage,
            );
            const isFamilyBest =
              bestOfferByFamily.get(entry.family) === item.id;
            const isTopResult = isBroadFamilySearch
              ? hasSearch && isFamilyBest
              : hasSearch && index === 0;
            const bestLabel = isBroadFamilySearch
              ? `Melhor oportunidade · ${familyLabel(entry.family)}`
              : "Melhor oportunidade encontrada";

            return (
              <Card
                key={item.id}
                className={isTopResult ? "border-primary/40 shadow-sm" : ""}
              >
                <CardContent className="p-4">
                  {isTopResult && (
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.13em] text-primary">
                      {bestLabel}
                    </p>
                  )}

                  <div className="flex items-start gap-3">
                    <ProductVisual
                      name={item.raw_name}
                      category={entry.product?.category}
                      imageUrl={item.image_url}
                    />
                    <div className="min-w-0 flex flex-1 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="font-bold leading-snug">{item.raw_name}</h2>
                        <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2 py-1">
                          <Store className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate text-xs font-bold text-foreground">
                            {flyer?.retailer ?? "Supermercado"}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {clubPrice ? (
                          <>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                              Clube
                            </p>
                            <p className="text-lg font-extrabold text-primary">
                              {brl(candidate.price)}
                            </p>
                            {candidate.baseUnit !== "un" && (
                              <p className="text-[11px] font-semibold text-primary">
                                {formatNormalizedPrice(
                                  candidate.normalizedPrice,
                                  candidate.baseUnit,
                                )}
                              </p>
                            )}
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Normal {brl(regularPrice)}
                              {regularNormalized.baseUnit !== "un"
                                ? " · " +
                                  formatNormalizedPrice(
                                    regularNormalized.normalizedPrice,
                                    regularNormalized.baseUnit,
                                  )
                                : ""}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-lg font-extrabold">
                              {brl(candidate.price)}
                            </p>
                            {candidate.baseUnit !== "un" && (
                              <p className="text-[11px] text-muted-foreground">
                                {formatNormalizedPrice(
                                  candidate.normalizedPrice,
                                  candidate.baseUnit,
                                )}
                              </p>
                            )}
                          </>
                        )}
                      </div>
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

                  {verdict.deltaPct !== null && (
                    <p
                      className={`mt-2 text-sm font-extrabold ${
                        verdict.deltaPct < 0
                          ? "text-red-500"
                          : verdict.deltaPct > 0
                            ? "text-red-500"
                            : "text-muted-foreground"
                      }`}
                    >
                      {verdict.deltaPct < 0
                        ? `↓ ${Math.abs(verdict.deltaPct).toFixed(0)}%`
                        : verdict.deltaPct > 0
                          ? `↑ ${Math.abs(verdict.deltaPct).toFixed(0)}%`
                          : "0%"}
                    </p>
                  )}

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
