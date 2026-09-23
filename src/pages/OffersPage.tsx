import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVoiceSearch } from "@/hooks/useVoiceSearch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ProductVisual from "@/components/ProductVisual";
import {
  BEEF_SEMANTIC_TOKENS,
  FISH_SEMANTIC_TOKENS,
  PORK_SEMANTIC_TOKENS,
  isBeefOfferText,
  isBroadBeefSearch,
  isBroadFishSearch,
  isBroadPorkSearch,
  isFishOfferText,
  isPorkOfferText,
} from "@/lib/beefSearch";
import AdaptiveProductName from "@/components/AdaptiveProductName";
import { requiresAppActivation } from "@/lib/clubOfferRules";
import { canonicalRetailerName } from "@/lib/retailerNames";
import {
  comparableCannedFishOffers,
  isCannedFishOffer,
  packagePriceIsMeaningfullyDifferent,
  prioritizeKgPrice,
} from "@/lib/offerPriceDisplay";
import {
  BadgeCheck,
  ChevronRight,
  Clock3,
  History,
  Mic,
  Radar,
  Search,
  ShoppingBasket,
  Sparkles,
  Upload,
  Store,
  Tags,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  evaluateFlyerOffer,
  findComparableProducts,
  findComparablePurchaseProducts,
  formatNormalizedPrice,
  inferPackage,
  matchFlyerItem,
  offerPackageInfo,
  offerReferenceFamiliesCompatible,
  offerReferenceFamilyKey,
  offerReferenceRequiresKnownCount,
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
  offer_notes?: string[] | null;
};

type SearchOfferItemRow = FlyerItemRow & {
  normalized_name?: string | null;
  retailer: string;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
};

type AliasRow = {
  product_id: string;
  normalized_alias: string;
  retailer?: string | null;
};

type PurchasePriceRow = {
  product_id: string;
  price: number | string;
  date?: string | null;
  supermarket?: string | null;
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

function expiryLabel(value: string | null | undefined, today: string) {
  if (!value) return "—";
  if (value === today) return "até HOJE";

  const todayMatch = today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (todayMatch) {
    const tomorrowDate = new Date(
      Date.UTC(
        Number(todayMatch[1]),
        Number(todayMatch[2]) - 1,
        Number(todayMatch[3]) + 1,
      ),
    );
    const tomorrow =
      `${tomorrowDate.getUTCFullYear()}-${String(
        tomorrowDate.getUTCMonth() + 1,
      ).padStart(2, "0")}-${String(tomorrowDate.getUTCDate()).padStart(
        2,
        "0",
      )}`;
    if (value === tomorrow) return "até AMANHÃ";
  }

  return `até ${dateBr(value)}`;
}

function packageLabel(item: FlyerItemRow) {
  const quantity = Number(item.package_quantity);
  const rawUnit = String(item.package_unit ?? "").trim().toLowerCase();

  if (Number.isFinite(quantity) && quantity > 0 && rawUnit) {
    const unit =
      rawUnit === "l" || rawUnit === "lt"
        ? "L"
        : rawUnit === "unid" || rawUnit === "und"
          ? "un"
          : rawUnit;
    const value = quantity.toLocaleString("pt-BR", {
      maximumFractionDigits: 3,
    });
    return `${value} ${unit}`;
  }

  const trailing = item.raw_name.match(
    /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lt|un|und|unid)\s*$/i,
  );
  if (!trailing) return null;

  const unit = trailing[2].toLowerCase();
  const displayUnit =
    unit === "l" || unit === "lt"
      ? "L"
      : unit === "unid" || unit === "und"
        ? "un"
        : unit;

  return `${trailing[1]} ${displayUnit}`;
}

function compactOfferName(item: FlyerItemRow) {
  return item.raw_name
    .trim()
    .replace(
      /\b(?:pacote|pct|embalagem|garrafa|lata|caixa|frasco|pote)\s+(?=\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|un|und|unid)\b)/gi,
      "",
    )
    .replace(
      /\s+\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|lt|un|und|unid)\s*$/i,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
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
  | "beef"
  | "pork"
  | "fish"
  | "cannedFish"
  | "other";

type SearchFamilyIntent = OfferFamily | "milk" | "corn" | "coffee";

function hasAny(tokens: Set<string>, values: string[]) {
  return values.some((value) => tokens.has(value));
}

function queryOfferFamily(query: string): SearchFamilyIntent | null {
  if (isBroadBeefSearch(query)) return "beef";
  if (isBroadPorkSearch(query)) return "pork";
  if (isBroadFishSearch(query)) return "fish";

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

    // Plain "leite" means liquid milk. Derived dairy products have their
    // own explicit intents (leite em pó, condensado, creme de leite, etc.).
    return "milkLiquid";
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
  if (isBeefOfferText(raw)) return "beef";
  if (isPorkOfferText(raw)) return "pork";
  if (isCannedFishOffer(raw)) return "cannedFish";
  if (isFishOfferText(raw)) return "fish";
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
  if (family === "beef") return "Carne bovina";
  if (family === "pork") return "Carne suína";
  if (family === "fish") return "Peixe";
  if (family === "cannedFish") return "Peixe enlatado";
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
  if (intent === "beef") add(...BEEF_SEMANTIC_TOKENS);
  if (intent === "pork") add(...PORK_SEMANTIC_TOKENS);
  if (intent === "fish") add(...FISH_SEMANTIC_TOKENS);

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
  if (intent === "beef") return family === "beef";
  if (intent === "pork") return family === "pork";
  if (intent === "fish") {
    return family === "fish" || family === "cannedFish";
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
    normalizedItemBrand: string;
    normalizedProductBrand: string;
    normalizedRawName: string;
    normalizedProductName: string;
  },
  normalizedQuery: string,
) {
  if (!normalizedQuery) return 0;

  const {
    normalizedItemBrand: itemBrand,
    normalizedProductBrand: productBrand,
    normalizedRawName: rawName,
    normalizedProductName: productName,
  } = entry;

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
  const currentIsCannedFish = isCannedFishOffer(current.raw_name);
  const previousIsCannedFish = isCannedFishOffer(previous.raw_name);

  if (currentIsCannedFish || previousIsCannedFish) {
    return comparableCannedFishOffers(
      current.raw_name,
      current.package_quantity,
      current.package_unit,
      previous.raw_name,
      previous.package_quantity,
      previous.package_unit,
    );
  }

  const currentPrice = Number(current.advertised_price) || 0;
  const previousPrice = Number(previous.advertised_price) || 0;
  const currentPackage = offerPackageInfo(
    current.raw_name,
    current.package_quantity,
    current.package_unit,
    current.offer_notes,
    currentPrice,
  );
  const previousPackage = offerPackageInfo(
    previous.raw_name,
    previous.package_quantity,
    previous.package_unit,
    previous.offer_notes,
    previousPrice,
  );
  const currentBaseUnit = currentPackage?.baseUnit ?? current.base_unit;
  const previousBaseUnit = previousPackage?.baseUnit ?? previous.base_unit;

  if (
    currentBaseUnit &&
    previousBaseUnit &&
    currentBaseUnit !== previousBaseUnit
  ) {
    return false;
  }

  const familyCompatibility = offerReferenceFamiliesCompatible(
    current.raw_name,
    previous.raw_name,
  );
  if (familyCompatibility === false) return false;

  if (familyCompatibility === true) {
    const familyKey = offerReferenceFamilyKey(current.raw_name);
    if (
      offerReferenceRequiresKnownCount(familyKey) &&
      (
        !currentPackage ||
        !previousPackage ||
        currentPackage.baseUnit !== "un" ||
        previousPackage.baseUnit !== "un"
      )
    ) {
      return false;
    }
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
  const regularPrice = Number(item.advertised_price) || 0;
  const clubPrice = validClubPrice(item);
  const effectivePrice = clubPrice ?? regularPrice;
  const packageInfo = offerPackageInfo(
    item.raw_name,
    item.package_quantity,
    item.package_unit,
    item.offer_notes,
    effectivePrice,
  );
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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const {
    isListening,
    error: voiceSearchError,
    startListening,
    stopListening,
  } = useVoiceSearch();
  const normalizedSearch = search.trim();
  const hasSearch = normalizedSearch.length >= 2;
  const today = useMemo(() => localDateKey(), []);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const key = `preco360-soap-image-pilot-v1:${user.id}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      // Storage is only used to avoid repeating the pilot trigger.
    }

    let cancelled = false;
    void supabase.functions
      .invoke("resolve-flyer-images", {
        body: { scope: "soap_pilot" },
      })
      .then(({ error }) => {
        if (cancelled || error) return;
        try {
          localStorage.setItem(key, new Date().toISOString());
        } catch {
          // The resolver remains idempotent even without localStorage.
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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
        .eq("user_id", user!.id)
        .lte("valid_from", today)
        .gte("valid_to", today)
        .order("retailer");

      if (error) throw error;
      return (data ?? []) as FlyerRow[];
    },
  });

  const activeFlyers = flyers;

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
        .eq("user_id", user!.id)
        .in("flyer_id", activeFlyerIds);

      if (error) throw error;
      return count ?? 0;
    },
  });

  const {
    data: productContext,
    isLoading: loadingProductContext,
    error: productContextError,
  } = useQuery({
    queryKey: ["live-market-product-context", user?.id],
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const [
        { data: products, error: productsError },
        { data: aliases, error: aliasesError },
      ] = await Promise.all([
        db
          .from("products")
          .select(
            "id,name,category,brand,package_size,unit,image_url,image_source",
          )
          .eq("user_id", user!.id)
          .order("name")
          .abortSignal(signal),
        db
          .from("product_aliases")
          .select("product_id,normalized_alias,retailer")
          .eq("user_id", user!.id)
          .abortSignal(signal),
      ]);

      if (productsError) throw productsError;
      if (aliasesError) throw aliasesError;

      return {
        products: (products ?? []) as ProductForMatch[],
        aliases: (aliases ?? []) as AliasRow[],
      };
    },
  });

  const searchRequest = useMemo(
    () => searchTokens(normalizedSearch).join(" "),
    [normalizedSearch],
  );

  const {
    data: searchRows = [],
    isLoading: loadingSearchRows,
    error: searchRowsError,
  } = useQuery<SearchOfferItemRow[]>({
    queryKey: ["live-market-offer-search-v1", user?.id, today, searchRequest],
    enabled: !!user && hasSearch && searchRequest.length >= 2,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await db
        .rpc("search_offer_items_v1", {
          p_query: searchRequest,
          p_on_date: today,
          p_active_limit: 120,
          p_history_limit: 180,
        })
        .abortSignal(signal);

      if (error) throw error;
      return (data ?? []) as SearchOfferItemRow[];
    },
  });

  const isLoading =
    loadingFlyers ||
    (hasSearch && (loadingProductContext || loadingSearchRows));
  const error = flyersError || productContextError || searchRowsError;

  const baseOffers = useMemo(() => {
    if (!hasSearch || !productContext || !searchRows.length) return [];

    const productMap = new Map(
      productContext.products.map((product) => [product.id, product]),
    );

    const historicalItems = searchRows.filter((item) => !item.is_active);
    const activeItems = searchRows.filter((item) => item.is_active);

    const historyByProduct = new Map<string, FlyerItemRow[]>();
    for (const previous of historicalItems) {
      if (!previous.product_id) continue;
      const rows = historyByProduct.get(previous.product_id) ?? [];
      rows.push(previous);
      historyByProduct.set(previous.product_id, rows);
    }

    return activeItems.map((item) => {
      const flyer: FlyerRow = {
        id: item.flyer_id,
        retailer: item.retailer,
        valid_from: item.valid_from,
        valid_to: item.valid_to,
      };
      const candidate = candidateFromItem(item);

      let productId = item.product_id;
      if (!productId) {
        productId = matchFlyerItem(
          candidate,
          productContext.products,
          productContext.aliases,
          item.retailer,
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

      const searchText = `${item.raw_name} ${item.brand ?? ""} ${product?.name ?? ""} ${product?.brand ?? ""} ${product?.category ?? ""}`;

      return {
        item,
        flyer,
        product,
        productId,
        candidate,
        previousAdvertised,
        family: inferOfferFamily(item, product),
        searchText,
        searchTokens: searchTokens(searchText),
        normalizedItemBrand: normalizeSearchText(item.brand ?? "").trim(),
        normalizedProductBrand: normalizeSearchText(product?.brand ?? "").trim(),
        normalizedRawName: normalizeSearchText(item.raw_name),
        normalizedProductName: normalizeSearchText(product?.name ?? ""),
      };
    });
  }, [hasSearch, productContext, searchRows]);

  const relevantProductIds = useMemo(() => {
    if (!productContext || !baseOffers.length) return [];

    const ids = new Set<string>();
    for (const entry of baseOffers) {
      if (entry.productId) ids.add(entry.productId);
      for (const product of findComparableProducts(
        entry.candidate,
        productContext.products,
      )) {
        ids.add(product.id);
      }
    }

    return [...ids].sort();
  }, [baseOffers, productContext]);

  const relevantProductIdsKey = relevantProductIds.join(",");

  const { data: purchasePrices = [] } = useQuery<PurchasePriceRow[]>({
    queryKey: [
      "live-market-purchase-history-v1",
      user?.id,
      relevantProductIdsKey,
    ],
    enabled: !!user && relevantProductIds.length > 0,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await db
        .rpc("get_product_price_history_v1", {
          p_product_ids: relevantProductIds,
          p_per_product_limit: 24,
        })
        .abortSignal(signal);

      if (error) throw error;
      return (data ?? []) as PurchasePriceRow[];
    },
  });

  const preparedOffers = useMemo(() => {
    if (!productContext || !baseOffers.length) return [];

    const pricesByProduct = new Map<string, PurchasePriceRow[]>();
    for (const row of purchasePrices) {
      const rows = pricesByProduct.get(row.product_id) ?? [];
      rows.push(row);
      pricesByProduct.set(row.product_id, rows);
    }

    const productsWithPrices = productContext.products.map((product) => ({
      ...product,
      prices: pricesByProduct.get(product.id) ?? [],
    }));
    const pricedProductMap = new Map(
      productsWithPrices.map((product) => [product.id, product]),
    );

    return baseOffers
      .map((entry) => {
        const product = entry.productId
          ? pricedProductMap.get(entry.productId) ?? entry.product
          : entry.product;

        const comparablePurchaseProducts =
          findComparablePurchaseProducts(
            entry.candidate,
            productsWithPrices,
          );

        const verdict = evaluateFlyerOffer(
          entry.candidate,
          product,
          entry.previousAdvertised,
          comparablePurchaseProducts,
        );

        return {
          ...entry,
          product,
          verdict,
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
  }, [baseOffers, productContext, purchasePrices]);

  const analyzed = useMemo(() => {
    if (!hasSearch || !preparedOffers.length) return [];

    const queryFamily = queryOfferFamily(normalizedSearch);
    const semanticTokens = familySemanticTokens(queryFamily);
    const wantedTokens = searchTokens(normalizedSearch).filter(
      (token) => !semanticTokens.has(token),
    );
    const normalizedQuery = normalizeSearchText(normalizedSearch).trim();

    const matches = preparedOffers.filter((entry) => {
      if (!familyMatchesIntent(entry.family, queryFamily)) return false;
      if (!wantedTokens.length) return true;

      return wantedTokens.every((needle) =>
        entry.searchTokens.some((token) =>
          token === needle ||
          token.includes(needle) ||
          (needle.length >= 4 &&
            token.length >= 3 &&
            needle.startsWith(token)),
        ),
      );
    });

    // Build stable semantic groups first. A pairwise comparator alone is not
    // enough here because an unrelated item between two comparable offers can
    // make Array.sort non-transitive (e.g. Nescau powder -> Nescau drink ->
    // Nescau powder). Grouping guarantees every comparable family is sorted
    // internally by its real effective unit price.
    const groups: typeof matches[] = [];

    for (const entry of matches) {
      const group = groups.find((candidateGroup) =>
        candidateGroup.some(
          (member) =>
            member.family === entry.family &&
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
            searchRelevance(b, normalizedQuery) -
            searchRelevance(a, normalizedQuery);
          if (relevanceDiff) return relevanceDiff;

          if (a.family === "cannedFish" && b.family === "cannedFish") {
            const packagePriceDiff = a.candidate.price - b.candidate.price;
            if (Math.abs(packagePriceDiff) > 0.0001) return packagePriceDiff;
          } else if (a.candidate.baseUnit === b.candidate.baseUnit) {
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
              searchRelevance(entry, normalizedQuery),
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
  }, [preparedOffers, hasSearch, normalizedSearch]);

  const explicitSearchFamily = useMemo(
    () => queryOfferFamily(normalizedSearch),
    [normalizedSearch],
  );
  const isBroadFamilySearch =
    explicitSearchFamily === null ||
    explicitSearchFamily === "milk" ||
    explicitSearchFamily === "corn" ||
    explicitSearchFamily === "coffee" ||
    explicitSearchFamily === "beef" ||
    explicitSearchFamily === "pork" ||
    explicitSearchFamily === "fish";

  const bestOfferByFamily = useMemo(() => {
    const bestEntry = new Map<
      OfferFamily,
      { id: string; primaryPrice: number; packagePrice: number }
    >();

    for (const entry of analyzed) {
      const current = bestEntry.get(entry.family);
      const candidatePrice =
        entry.family === "cannedFish"
          ? entry.candidate.price
          : entry.candidate.normalizedPrice;

      if (
        !current ||
        candidatePrice < current.primaryPrice - 0.0001 ||
        (Math.abs(candidatePrice - current.primaryPrice) <= 0.0001 &&
          entry.candidate.price < current.packagePrice)
      ) {
        bestEntry.set(entry.family, {
          id: entry.item.id,
          primaryPrice: candidatePrice,
          packagePrice: entry.candidate.price,
        });
      }
    }

    return new Map(
      [...bestEntry.entries()].map(([family, entry]) => [family, entry.id]),
    );
  }, [analyzed]);

  const resultFamilyCount = useMemo(
    () => new Set(analyzed.map((entry) => entry.family)).size,
    [analyzed],
  );

  const activeFlyerCount = activeFlyers.length;
  const allActiveOfferCount = activeOfferCount;

  return (
    <div className="page-container !pb-24 mx-auto w-full max-w-3xl">
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
          ref={searchInputRef}
          className="h-12 pl-10 pr-12 text-base"
          placeholder={
            isListening
              ? "Ouvindo o produto..."
              : "Busque Nescau, café, leite, carne..."
          }
          value={searchInput}
          onChange={(event) => {
            const value = event.target.value;
            setSearchInput(value);
            if (searchTimerRef.current !== null) {
              window.clearTimeout(searchTimerRef.current);
            }
            searchTimerRef.current = window.setTimeout(() => {
              setSearch(value);
            }, 140);
          }}
          autoFocus
        />
        <button
          type="button"
          className={`absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors ${
            isListening
              ? "bg-primary/15 text-primary animate-pulse"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          aria-label={isListening ? "Parar busca por voz" : "Buscar produto por voz"}
          aria-pressed={isListening}
          title={isListening ? "Parar" : "Buscar por voz"}
          onClick={() => {
            if (isListening) {
              stopListening();
              return;
            }

            searchInputRef.current?.blur();
            if (searchTimerRef.current !== null) {
              window.clearTimeout(searchTimerRef.current);
              searchTimerRef.current = null;
            }

            startListening((transcript) => {
              setSearchInput(transcript);
              setSearch(transcript);
            });
          }}
        >
          <Mic className="h-4 w-4" />
        </button>
      </div>
      {voiceSearchError && (
        <p className="-mt-1 mb-2 px-1 text-[10px] text-destructive">
          {voiceSearchError}
        </p>
      )}

      <div className="mb-2 grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-1.5 rounded-xl text-xs font-bold"
          onClick={() => navigate("/radar")}
        >
          <Radar className="h-3.5 w-3.5 text-primary" />
          Radar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-1.5 rounded-xl text-xs font-bold"
          onClick={() => navigate("/radar?view=import")}
        >
          <Upload className="h-3.5 w-3.5 text-primary" />
          Importar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-1.5 rounded-xl text-xs font-bold"
          onClick={() => navigate("/offers/basket")}
        >
          <ShoppingBasket className="h-3.5 w-3.5 text-primary" />
          Cesta
        </Button>
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
              Importe os tabloides atuais no Radar para liberar a consulta.
            </p>
            <Button className="mt-4" onClick={() => navigate("/radar?view=import")}>
              <Upload className="mr-2 h-4 w-4" />
              Importar tabloide
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
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {hasSearch ? "Resultado da busca" : "Melhores oportunidades vigentes"}
              </p>
              <p className="text-sm font-bold">
                {analyzed.length} oferta(s) encontrada(s)
              </p>
            </div>
            {hasSearch &&
              analyzed[0] &&
              (!isBroadFamilySearch || resultFamilyCount > 1) && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary">
                  {isBroadFamilySearch
                    ? "Melhor por tipo"
                    : "Melhor primeiro"}
                </span>
              )}
          </div>

          {analyzed.slice(0, hasSearch ? 30 : 12).map((entry, index) => {
            const { item, flyer, candidate, verdict, productId } = entry;
            const ui = verdictUi[verdict.key];
            const VerdictIcon = ui.Icon;
            const regularPrice = Number(item.advertised_price) || 0;
            const clubPrice = validClubPrice(item);
            const appActivationRequired =
              clubPrice !== null &&
              requiresAppActivation(flyer?.retailer, item.offer_notes);
            const regularPackage = offerPackageInfo(
              item.raw_name,
              item.package_quantity,
              item.package_unit,
              item.offer_notes,
              regularPrice,
            );
            const regularNormalized = normalizedUnitPrice(
              regularPrice,
              regularPackage,
            );
            const displayTitle = compactOfferName(item);
            const packLabel = packageLabel(item);
            const prioritizeUnitPrice = prioritizeKgPrice(
              entry.family,
              item.raw_name,
              candidate.baseUnit,
            );
            const showEffectivePackageTotal =
              prioritizeUnitPrice &&
              packagePriceIsMeaningfullyDifferent(
                candidate.price,
                candidate.normalizedPrice,
              );
            const showRegularPackageTotal =
              prioritizeUnitPrice &&
              regularNormalized.baseUnit === "kg" &&
              packagePriceIsMeaningfullyDifferent(
                regularPrice,
                regularNormalized.normalizedPrice,
              );
            const referenceLabel =
              verdict.referencePrice &&
              entry.family === "cannedFish" &&
              candidate.packageInfo?.baseUnit === "kg"
                ? brl(
                    verdict.referencePrice *
                      candidate.packageInfo.baseQuantity,
                  )
                : verdict.referencePrice
                  ? formatNormalizedPrice(
                      verdict.referencePrice,
                      candidate.baseUnit,
                    )
                  : null;
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
                <CardContent className="p-3 sm:p-4">
                  {isTopResult && (
                    <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-primary">
                      {bestLabel}
                    </p>
                  )}

                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-1 sm:gap-x-3">
                    <ProductVisual
                      name={item.raw_name}
                      category={entry.product?.category}
                      imageUrl={item.image_url}
                      compact
                    />

                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <AdaptiveProductName
                            text={displayTitle}
                            className="font-bold"
                            minPx={11}
                            maxPx={15}
                            desktopMaxPx={16}
                          />
                        </div>
                        {packLabel && (
                          <span className="shrink-0 rounded-md border border-white/10 bg-muted/55 px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-foreground/90 sm:text-[11px]">
                            {packLabel}
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-bold">
                          <Store className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate">
                            {canonicalRetailerName(flyer?.retailer) || "Supermercado"}
                          </span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${ui.className}`}
                        >
                          <VerdictIcon className="h-3.5 w-3.5" />
                          {ui.label}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" />
                          {expiryLabel(flyer?.valid_to, today)}
                        </span>
                      </div>
                    </div>

                    <div className="min-w-[80px] max-w-[142px] shrink-0 text-right sm:min-w-[88px] sm:max-w-[150px]">
                      {clubPrice ? (
                        <>
                          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-primary">
                            Clube
                          </p>
                          {appActivationRequired && (
                            <p className="mb-0.5 text-[8px] font-bold uppercase leading-tight text-amber-500">
                              * ativar desconto APP
                            </p>
                          )}
                          <p className="text-lg font-extrabold leading-tight sm:text-xl text-primary">
                            {prioritizeUnitPrice
                              ? formatNormalizedPrice(
                                  candidate.normalizedPrice,
                                  candidate.baseUnit,
                                )
                              : brl(candidate.price)}
                          </p>
                          {prioritizeUnitPrice ? (
                            showEffectivePackageTotal && (
                              <p className="mt-0.5 text-[10px] font-semibold text-primary/85">
                                Embalagem {brl(candidate.price)}
                              </p>
                            )
                          ) : (
                            candidate.baseUnit !== "un" && (
                              <p className="mt-0.5 text-[10px] font-semibold text-primary">
                                {formatNormalizedPrice(
                                  candidate.normalizedPrice,
                                  candidate.baseUnit,
                                )}
                              </p>
                            )
                          )}
                          <p className="mt-0.5 text-[9px] leading-tight text-muted-foreground/80">
                            {prioritizeUnitPrice &&
                            regularNormalized.baseUnit === "kg" ? (
                              <>
                                Normal{" "}
                                {formatNormalizedPrice(
                                  regularNormalized.normalizedPrice,
                                  regularNormalized.baseUnit,
                                )}
                                {showRegularPackageTotal
                                  ? " · embalagem " + brl(regularPrice)
                                  : ""}
                              </>
                            ) : (
                              <>
                                Normal {brl(regularPrice)}
                                {regularNormalized.baseUnit !== "un"
                                  ? " · " +
                                    formatNormalizedPrice(
                                      regularNormalized.normalizedPrice,
                                      regularNormalized.baseUnit,
                                    )
                                  : ""}
                              </>
                            )}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-lg font-extrabold leading-tight sm:text-xl">
                            {prioritizeUnitPrice
                              ? formatNormalizedPrice(
                                  candidate.normalizedPrice,
                                  candidate.baseUnit,
                                )
                              : brl(candidate.price)}
                          </p>
                          {prioritizeUnitPrice ? (
                            showEffectivePackageTotal && (
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                Embalagem {brl(candidate.price)}
                              </p>
                            )
                          ) : (
                            candidate.baseUnit !== "un" && (
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                {formatNormalizedPrice(
                                  candidate.normalizedPrice,
                                  candidate.baseUnit,
                                )}
                              </p>
                            )
                          )}
                        </>
                      )}

                      {(verdict.deltaPct !== null ||
                        verdict.referencePrice ||
                        productId) && (
                        <div className="mt-1 flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5 text-[9px] leading-tight">
                          {verdict.deltaPct !== null && (
                            <span
                              className={`font-extrabold ${
                                verdict.deltaPct < 0
                                  ? "text-green-500"
                                  : verdict.deltaPct > 0
                                    ? "text-red-500"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {verdict.deltaPct < 0
                                ? `↓${Math.abs(verdict.deltaPct).toFixed(0)}%`
                                : verdict.deltaPct > 0
                                  ? `↑${Math.abs(verdict.deltaPct).toFixed(0)}%`
                                  : "0%"}
                            </span>
                          )}

                          {verdict.referencePrice &&
                            (productId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(`/product/${productId}`)
                                }
                                className="inline-flex items-center gap-0.5 font-semibold text-muted-foreground transition-colors hover:text-primary"
                                aria-label="Ver histórico do produto"
                              >
                                {verdict.purchaseCount > 0 ? "Pago " : "Ref. "}
                                {referenceLabel}
                                <ChevronRight className="h-3 w-3" />
                              </button>
                            ) : (
                              <span className="font-semibold text-muted-foreground">
                                {verdict.purchaseCount > 0 ? "Pago " : "Ref. "}
                                {referenceLabel}
                              </span>
                            ))}

                          {!verdict.referencePrice && productId && (
                            <button
                              type="button"
                              onClick={() => navigate(`/product/${productId}`)}
                              className="inline-flex items-center gap-0.5 font-semibold text-muted-foreground transition-colors hover:text-primary"
                            >
                              Histórico
                              <ChevronRight className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
