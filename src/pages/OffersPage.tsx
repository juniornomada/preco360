import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ProductSearchBar from "@/components/ProductSearchBar";
import {
  normalizeProductSearchText,
  productMatchesSearch,
  productSearchRequestVariants,
} from "@/lib/productSearch";
import ProductVisual from "@/components/ProductVisual";
import RetailerLogo from "@/components/RetailerLogo";
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
  isGenericPoncaSearch,
  isGenericSaltSearch,
  isPowderedDrinkSearch,
  isGenericSugarSearch,
  isSaltProductName,
  isSugarProductName,
  normalizePoncaSearchToken,
  powderedDrinkSearchRequests,
  PONCA_SEARCH_VARIANTS,
} from "@/lib/offerSearchGuard";
import {
  comparableCannedFishOffers,
  isCannedFishOffer,
  packagePriceIsMeaningfullyDifferent,
  prioritizeKgPrice,
} from "@/lib/offerPriceDisplay";
import {
  BadgeCheck,
  Camera,
  ChevronRight,
  Clock3,
  History,
  ReceiptText,
  Search,
  Sparkles,
  Store,
  Tags,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import {
  evaluateFlyerOffer,
  findComparableProducts,
  findComparablePurchaseProducts,
  formatNormalizedPrice,
  inferPackage,
  isCapacitySpecificationProduct,
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
  source?: string | null;
  normalized_price?: number | string | null;
  base_unit?: "kg" | "l" | "un" | null;
  package_quantity?: number | string | null;
  package_unit?: string | null;
  receipt_text?: string | null;
};

type StoreReferenceRow = {
  id: string;
  product_id: string | null;
  supermarket: string;
  observed_date: string;
  raw_name: string;
  retail_price: number | string;
  normalized_retail_price: number | string | null;
  base_unit: "kg" | "l" | "un" | null;
  package_quantity: number | string | null;
  package_unit: string | null;
  products:
    | {
        id: string;
        name: string;
      }
    | null;
};

function normalizeOfferNotes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item ?? "").trim())
            .filter(Boolean);
        }
      } catch {
        // Keep the original value as a single note below.
      }
    }

    return [trimmed];
  }

  return [];
}

function sanitizeSearchOfferRow(value: unknown): SearchOfferItemRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  const id = String(row.id ?? "").trim();
  const flyerId = String(row.flyer_id ?? "").trim();
  const rawName = String(
    row.raw_name ?? row.normalized_name ?? "",
  ).trim();
  const retailer = String(row.retailer ?? "").trim();
  const price = Number(row.advertised_price);

  // A malformed row must never take down the whole Offers page.
  if (
    !id ||
    !flyerId ||
    !rawName ||
    !retailer ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    console.warn("Ignoring malformed offer search row", {
      id,
      flyerId,
      rawName,
      retailer,
      advertisedPrice: row.advertised_price,
    });
    return null;
  }

  const baseUnit =
    row.base_unit === "kg" || row.base_unit === "l" || row.base_unit === "un"
      ? row.base_unit
      : null;

  return {
    id,
    flyer_id: flyerId,
    product_id:
      row.product_id === null || row.product_id === undefined
        ? null
        : String(row.product_id),
    raw_name: rawName,
    normalized_name:
      typeof row.normalized_name === "string" ? row.normalized_name : null,
    brand: typeof row.brand === "string" ? row.brand : null,
    package_quantity:
      row.package_quantity === null || row.package_quantity === undefined
        ? null
        : Number(row.package_quantity),
    package_unit:
      typeof row.package_unit === "string" ? row.package_unit : null,
    advertised_price: price,
    normalized_price:
      row.normalized_price === null || row.normalized_price === undefined
        ? null
        : Number(row.normalized_price),
    base_unit: baseUnit,
    club_price: row.club_price === true,
    club_advertised_price:
      row.club_advertised_price === null ||
      row.club_advertised_price === undefined
        ? null
        : Number(row.club_advertised_price),
    source_page:
      row.source_page === null || row.source_page === undefined
        ? null
        : Number(row.source_page),
    image_url: typeof row.image_url === "string" ? row.image_url : null,
    offer_notes: normalizeOfferNotes(row.offer_notes),
    retailer,
    valid_from: typeof row.valid_from === "string" ? row.valid_from : null,
    valid_to: typeof row.valid_to === "string" ? row.valid_to : null,
    is_active: row.is_active === true || row.is_active === "true",
  };
}

const verdictOrder = {
  exceptional: 0,
  good: 1,
  normal: 2,
  high: 3,
  unknown: 4,
} as const;

const verdictUi = {
  exceptional: {
    label: "Bem abaixo do histórico",
    className: "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400/90",
    Icon: TrendingDown,
  },
  good: {
    label: "Abaixo do histórico",
    className: "border-green-500/20 bg-green-500/[0.05] text-green-400/90",
    Icon: TrendingDown,
  },
  normal: {
    label: "Na faixa histórica",
    className: "border-border/80 bg-muted/35 text-muted-foreground",
    Icon: BadgeCheck,
  },
  high: {
    label: "Acima do histórico",
    className: "border-red-500/30 bg-red-500/[0.07] text-red-400",
    Icon: TrendingUp,
  },
  unknown: {
    label: "Sem histórico",
    className: "border-border bg-muted/40 text-muted-foreground",
    Icon: History,
  },
} as const;

const brl = (value: number | null | undefined) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return numericValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
};

type HistoricalReferenceValue = {
  value: number;
  baseUnit: "kg" | "l" | "un";
};

function medianValue(values: number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentileValue(values: number[], percentile: number) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];

  const position = Math.max(
    0,
    Math.min(sorted.length - 1, (sorted.length - 1) * percentile),
  );
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];

  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function purchasePackageBaseQuantity(
  row: PurchasePriceRow,
  product?: ProductForMatch | null,
) {
  const pkg =
    Number(row.package_quantity) > 0 && row.package_unit
      ? inferPackage(`${row.package_quantity}${row.package_unit}`)
      : product && Number(product.package_size) > 0 && product.unit
        ? inferPackage(`${product.package_size}${product.unit}`)
        : product?.name
          ? inferPackage(product.name)
          : null;

  return pkg
    ? { baseQuantity: pkg.baseQuantity, baseUnit: pkg.baseUnit }
    : null;
}

function storePackageBaseQuantity(row: StoreReferenceRow) {
  const pkg =
    Number(row.package_quantity) > 0 && row.package_unit
      ? inferPackage(`${row.package_quantity}${row.package_unit}`)
      : inferPackage(row.raw_name);

  return pkg
    ? { baseQuantity: pkg.baseQuantity, baseUnit: pkg.baseUnit }
    : null;
}

function historicalPackageLabel(
  quantity?: number | string | null,
  unit?: string | null,
) {
  const numeric = Number(quantity);
  const normalizedUnit = String(unit ?? "").trim().toLowerCase();
  if (!Number.isFinite(numeric) || numeric <= 0 || !normalizedUnit) return null;

  return `${numeric.toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
  })} ${normalizedUnit}`;
}

function receiptHistoricalPackageLabel(
  row: PurchasePriceRow,
  product?: ProductForMatch | null,
) {
  const productName = String(product?.name ?? "");
  const multi = productName.match(
    /\b(\d+)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lt)\b/i,
  );

  if (multi) {
    const count = Number(multi[1]);
    const size = Number(multi[2].replace(",", "."));
    const rawUnit = multi[3].toLowerCase();
    const unit = rawUnit === "lt" ? "l" : rawUnit;
    const total = count * size;
    const displayUnit = unit === "l" ? "L" : unit;

    return `${count} × ${size.toLocaleString("pt-BR", {
      maximumFractionDigits: 3,
    })} ${displayUnit} = ${total.toLocaleString("pt-BR", {
      maximumFractionDigits: 3,
    })} ${displayUnit}`;
  }

  return historicalPackageLabel(
    row.package_quantity ?? product?.package_size,
    row.package_unit ?? product?.unit,
  );
}

function purchaseReferenceValue(
  row: PurchasePriceRow,
  product?: ProductForMatch | null,
): HistoricalReferenceValue | null {
  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const rowPackage =
    Number(row.package_quantity) > 0 && row.package_unit
      ? inferPackage(`${row.package_quantity}${row.package_unit}`)
      : null;
  const productPackage =
    product && Number(product.package_size) > 0 && product.unit
      ? inferPackage(`${product.package_size}${product.unit}`)
      : product?.name
        ? inferPackage(product.name)
        : null;

  const normalized = Number(row.normalized_price);
  if (
    Number.isFinite(normalized) &&
    normalized > 0 &&
    (row.base_unit === "kg" || row.base_unit === "l" || row.base_unit === "un")
  ) {
    if (
      row.base_unit === "un" &&
      productPackage &&
      productPackage.baseUnit !== "un"
    ) {
      return normalizedUnitPrice(price, productPackage);
    }

    return { value: normalized, baseUnit: row.base_unit };
  }

  const pkg = rowPackage ?? productPackage;
  if (!pkg) return null;

  return normalizedUnitPrice(price, pkg);
}

function storeReferenceValue(
  row: StoreReferenceRow,
): HistoricalReferenceValue | null {
  const normalized = Number(row.normalized_retail_price);
  if (
    Number.isFinite(normalized) &&
    normalized > 0 &&
    (row.base_unit === "kg" || row.base_unit === "l" || row.base_unit === "un")
  ) {
    return { value: normalized, baseUnit: row.base_unit };
  }

  const price = Number(row.retail_price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const pkg =
    Number(row.package_quantity) > 0 && row.package_unit
      ? inferPackage(`${row.package_quantity}${row.package_unit}`)
      : inferPackage(row.raw_name);
  if (!pkg) return null;

  return normalizedUnitPrice(price, pkg);
}

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

  if (!isCapacitySpecificationProduct(item.raw_name)) {
    const effective = offerPackageInfo(
      item.raw_name,
      item.package_quantity,
      item.package_unit,
      item.offer_notes,
      Number(item.advertised_price) || 0,
    );

    if (effective) {
      let displayQuantity = effective.quantity;
      let displayUnit: string = effective.unit;

      if (effective.unit === "ml" && effective.quantity >= 1000) {
        displayQuantity = effective.quantity / 1000;
        displayUnit = "L";
      } else if (effective.unit === "g" && effective.quantity >= 1000) {
        displayQuantity = effective.quantity / 1000;
        displayUnit = "kg";
      } else if (effective.unit === "l") {
        displayUnit = "L";
      }

      const value = displayQuantity.toLocaleString("pt-BR", {
        maximumFractionDigits: 3,
      });
      return `${value} ${displayUnit}`;
    }
  }

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
      return normalizePoncaSearchToken(token);
    })
    .filter((token) => !searchStopWords.has(token));
}

type OfferFamily =
  | "powder"
  | "powderedDrink"
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
  | "sugar"
  | "salt"
  | "disinfectant"
  | "alcoholDisinfectant"
  | "other";

type SearchFamilyIntent = OfferFamily | "milk" | "corn" | "coffee";

function hasAny(tokens: Set<string>, values: string[]) {
  return values.some((value) => tokens.has(value));
}

function queryOfferFamily(query: string): SearchFamilyIntent | null {
  if (isGenericSaltSearch(query)) return "salt";
  if (isGenericSugarSearch(query)) return "sugar";

  const normalized = normalizeSearchText(query);
  if (
    /^desinfetante\b/.test(normalized) &&
    /\balcool(?:ico|ica)?\b/.test(normalized)
  ) {
    return "alcoholDisinfectant";
  }
  if (/^alcool\b/.test(normalized)) return "alcoholDisinfectant";
  if (/^desinfetante\b/.test(normalized)) return "disinfectant";

  if (isBroadBeefSearch(query)) return "beef";
  if (isBroadPorkSearch(query)) return "pork";
  if (isBroadFishSearch(query)) return "fish";

  const tokens = new Set(searchTokens(query));
  const hasMilk = hasAny(tokens, ["leite", "leites"]);
  const hasTomato = hasAny(tokens, ["tomate", "tomates"]);
  const hasCorn = hasAny(tokens, ["milho", "milhos"]);
  const hasCoffee = hasAny(tokens, ["cafe", "cafes"]);

  if (
    tokens.has("po") &&
    hasAny(tokens, ["suco", "sucos", "refresco", "refrescos"])
  ) {
    return "powderedDrink";
  }

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
  if (isSaltProductName(raw)) return "salt";
  if (isSugarProductName(raw)) return "sugar";
  if (isBeefOfferText(raw)) return "beef";
  if (isPorkOfferText(raw)) return "pork";
  if (isCannedFishOffer(raw)) return "cannedFish";
  if (isFishOfferText(raw)) return "fish";
  if (/^bolos?\b/.test(raw)) return "cake";

  if (/^desinfetante\b/.test(raw)) {
    return /\balcool(?:ico|ica)?\b/.test(raw)
      ? "alcoholDisinfectant"
      : "disinfectant";
  }
  if (/^alcool\b/.test(raw) && isVolume) return "alcoholDisinfectant";

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

  if (/^molho\b/.test(raw) && /\btomate\b/.test(raw)) return "tomatoSauce";
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

  if (
    tokens.has("po") &&
    hasAny(tokens, ["suco", "sucos", "refresco", "refrescos"]) &&
    isWeight
  ) {
    return "powderedDrink";
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
  if (family === "powderedDrink") return "Refresco em pó";
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
  if (family === "sugar") return "Açúcar";
  if (family === "salt") return "Sal";
  if (family === "disinfectant") return "Desinfetante";
  if (family === "alcoholDisinfectant") return "Álcool / desinfetante alcoólico";
  return "Produto";
}




function escapeRegex(value: string) {
  return value.replace(/[.*+?^$\\{}()|[\]\\]/g, "\\$&");
}

function cleanDisplayNamePart(value: string) {
  return value
    .replace(/\s*[/|-]\s*$/g, "")
    .replace(/^[,;:/|-]+\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function productHeadRule(
  family: OfferFamily,
  value: string,
): { label: string; pattern: RegExp } | null {
  if (family === "tomatoSauce") return { label: "Molho de Tomate", pattern: /^molho(?:\s+de)?\s+tomate\b/i };
  if (family === "tomatoExtract") return { label: "Extrato de Tomate", pattern: /^extrato(?:\s+de)?\s+tomate\b/i };
  if (family === "tomatoPassata") return { label: "Passata de Tomate", pattern: /^passata(?:\s+de)?\s+tomate\b/i };
  if (family === "tomatoPeeled") return { label: "Tomate Pelado", pattern: /^tomate(?:s)?\s+pelad[oa]s?\b/i };
  if (family === "milkLiquid") return { label: "Leite", pattern: /^leite\b/i };
  if (family === "milkPowder") return { label: "Leite em Pó", pattern: /^leite(?:\s+em)?\s+p[oó]\b/i };
  if (family === "milkCream") return { label: "Creme de Leite", pattern: /^(?:mistura\s+de\s+)?creme\s+de\s+leite\b/i };
  if (family === "milkCondensed") return { label: "Leite Condensado", pattern: /^leite\s+condensado\b/i };
  if (family === "milkFermented") return { label: "Leite Fermentado", pattern: /^leite\s+fermentado\b/i };
  if (family === "milkCoconut") return { label: "Leite de Coco", pattern: /^leite\s+de\s+coco\b/i };
  if (family === "milkSweet") return { label: "Doce de Leite", pattern: /^doce\s+de\s+leite\b/i };
  if (family === "coffeeGround") return { label: "Café", pattern: /^caf[eé]\b/i };
  if (family === "coffeeBeans") return { label: "Café em Grãos", pattern: /^caf[eé](?:\s+em)?\s+gr[aã]os?\b/i };
  if (family === "coffeeSoluble") return { label: "Café Solúvel", pattern: /^caf[eé]\s+sol[uú]vel\b/i };
  if (family === "coffeeCapsule") return { label: "Café em Cápsula", pattern: /^(?:caf[eé]\s+em\s+c[aá]psulas?|c[aá]psulas?\s+de\s+caf[eé])\b/i };
  if (family === "powder" && /^achocolatad/i.test(value)) {
    return { label: "Achocolatado em Pó", pattern: /^achocolatad[oa]s?(?:\s+em\s+p[oó])?\b/i };
  }
  if (family === "powderedDrink") {
    return { label: "Refresco em Pó", pattern: /^(?:refresco|suco)(?:\s+em)?\s+p[oó]\b/i };
  }
  if (family === "refrigerante") return { label: "Refrigerante", pattern: /^refrigerante\b/i };
  if (family === "juice" && /^suco\b/i.test(value)) return { label: "Suco", pattern: /^suco\b/i };
  if (family === "disinfectant") {
    return { label: "Desinfetante", pattern: /^desinfetante\b/i };
  }
  if (family === "alcoholDisinfectant") {
    return {
      label: "Álcool / desinfetante alcoólico",
      pattern: /^(?:desinfetante\s+)?[aá]lcool(?:\s+l[ií]quido)?\b/i,
    };
  }

  const genericRules: Array<{ label: string; pattern: RegExp }> = [
    { label: "Água Sanitária", pattern: /^[aá]gua\s+sanit[aá]ria\b/i },
    { label: "Água de Coco", pattern: /^[aá]gua\s+de\s+coco\b/i },
    { label: "Amaciante de Roupas", pattern: /^amaciante(?:\s+de|\s+para)?\s+roupas?\b/i },
    { label: "Sabão em Pó", pattern: /^sab[aã]o(?:\s+em)?\s+p[oó]\b/i },
    { label: "Detergente Líquido", pattern: /^detergente\s+l[ií]quido\b/i },
    { label: "Desinfetante", pattern: /^desinfetante\b/i },
    { label: "Creme Dental", pattern: /^creme\s+dental\b/i },
    { label: "Desodorante", pattern: /^desodorante\b/i },
    { label: "Absorvente", pattern: /^absorvente\b/i },
    { label: "Azeite de Oliva", pattern: /^azeite\s+de\s+oliva\b/i },
    { label: "Alimento para Cães", pattern: /^alimento\s+para\s+c[aã]es\b/i },
    { label: "Alimento para Gatos", pattern: /^alimento\s+para\s+gatos\b/i },
    { label: "Bebida Láctea", pattern: /^bebida\s+l[aá]ctea\b/i },
    { label: "Biscoito Recheado", pattern: /^biscoito\s+recheado\b/i },
    { label: "Biscoito Wafer", pattern: /^biscoito\s+wafer\b/i },
    { label: "Biscoito", pattern: /^biscoito\b/i },
    { label: "Cerveja", pattern: /^cerveja\b/i },
    { label: "Arroz", pattern: /^arroz\b/i },
    { label: "Feijão", pattern: /^feij[aã]o\b/i },
    { label: "Óleo de Soja", pattern: /^[oó]leo\s+de\s+soja\b/i },
    { label: "Farinha de Trigo", pattern: /^farinha\s+de\s+trigo\b/i },
    { label: "Papel Higiênico", pattern: /^papel\s+higi[eê]nico\b/i },
    { label: "Sabonete", pattern: /^sabonete\b/i },
    { label: "Shampoo", pattern: /^shampoo\b/i },
    { label: "Condicionador", pattern: /^condicionador\b/i },
    { label: "Açaí", pattern: /^a[cç]a[ií]\b/i },
    { label: "Atum", pattern: /^atum\b/i },
    { label: "Sardinha", pattern: /^sardinha\b/i },
    { label: "Carne Bovina", pattern: /^carne\s+bovina\b/i },
    { label: "Carne Suína", pattern: /^carne\s+su[ií]na\b/i },
  ];

  return genericRules.find((rule) => rule.pattern.test(value)) ?? null;
}

function standardizedOfferName(item: FlyerItemRow, family: OfferFamily) {
  let compact = compactOfferName(item);
  let brand = String(item.brand ?? "").trim();

  // Known OCR/catalog corrections that should stay stable across future imports.
  if (/\btomadoro\b/i.test(compact) || /\btomodoro\b/i.test(compact)) {
    compact = compact
      .replace(/\bbonari\b/gi, "")
      .replace(/\btomodoro\b/gi, "Tomadoro")
      .replace(/\btomadoro\b/gi, "Tomadoro")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!/\bbonare\b/i.test(compact)) {
      compact = compact.replace(
        /^molho(?:\s+de)?\s+tomate\b/i,
        "Molho de Tomate Bonare",
      );
    }
    brand = "Bonare";
  }
  if (/\btarantell?o\b/i.test(compact) || /\btarantella\b/i.test(compact)) {
    compact = "Molho de Tomate Tarantella Tradicional";
    brand = "Tarantella";
  }

  if (!compact || !brand) return compact;

  const brandPattern = new RegExp(
    "\\b" + escapeRegex(brand).replace(/\\ /g, "\\s+") + "\\b",
    "i",
  );
  const withoutBrand = cleanDisplayNamePart(compact.replace(brandPattern, " "));

  const headRule = productHeadRule(family, withoutBrand);
  if (!headRule) return compact;

  let remainder = cleanDisplayNamePart(withoutBrand.replace(headRule.pattern, " "));

  if (family === "tomatoSauce" && /^molho\s+tomate\b/i.test(withoutBrand)) {
    remainder = cleanDisplayNamePart(
      withoutBrand.replace(/^molho\s+tomate\b/i, " "),
    );
  }

  return [headRule.label, brand, remainder]
    .map(cleanDisplayNamePart)
    .filter(Boolean)
    .join(" ");
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

  if (intent === "powderedDrink") {
    add("po", "suco", "sucos", "refresco", "refrescos");
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
  if (intent === "sugar") add("acucar", "acucares");
  if (intent === "salt") add("sal");
  if (intent === "disinfectant") add("desinfetante", "desinfetantes");
  if (intent === "alcoholDisinfectant") {
    add(
      "alcool",
      "alcoolico",
      "alcoolica",
      "desinfetante",
      "desinfetantes",
    );
  }
  if (intent === "beef") add(...BEEF_SEMANTIC_TOKENS);
  if (intent === "pork") add(...PORK_SEMANTIC_TOKENS);
  if (intent === "fish") add(...FISH_SEMANTIC_TOKENS);

  return result;
}

function productReferenceFamily(product: ProductForMatch): OfferFamily {
  return inferOfferFamily(
    {
      id: `product-${product.id}`,
      flyer_id: "",
      product_id: product.id,
      raw_name: product.name,
      brand: product.brand ?? null,
      package_quantity: product.package_size ?? null,
      package_unit: product.unit ?? null,
      advertised_price: 1,
      normalized_price: null,
      base_unit: null,
    },
    product,
  );
}

function storeReferenceFamily(row: StoreReferenceRow): OfferFamily {
  return inferOfferFamily(
    {
      id: row.id,
      flyer_id: "",
      product_id: row.product_id,
      raw_name: row.raw_name,
      package_quantity: row.package_quantity,
      package_unit: row.package_unit,
      advertised_price: Number(row.retail_price) || 1,
      normalized_price: row.normalized_retail_price,
      base_unit: row.base_unit,
    },
    row.products
      ? {
          id: row.products.id,
          name: row.products.name,
        }
      : null,
  );
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

  const currentAnimalFamily = inferOfferFamily(current, null);
  const previousAnimalFamily = inferOfferFamily(previous, null);
  const protectedAnimalFamilies = new Set<OfferFamily>([
    "beef",
    "pork",
    "fish",
    "cannedFish",
  ]);
  if (
    (protectedAnimalFamilies.has(currentAnimalFamily) ||
      protectedAnimalFamilies.has(previousAnimalFamily)) &&
    currentAnimalFamily !== previousAnimalFamily
  ) {
    return false;
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
        previousPackage.baseUnit !== "un" ||
        currentPackage.baseQuantity <= 1 ||
        previousPackage.baseQuantity <= 1
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
    regularPrice,
  );
  const normalized = normalizedUnitPrice(effectivePrice, packageInfo);

  return {
    rawName: item.raw_name,
    brand: item.brand ?? null,
    price: effectivePrice,
    packageInfo,
    normalizedPrice: normalized.normalizedPrice,
    baseUnit: normalized.baseUnit,
    clubPrice: clubPrice !== null,
    sourcePage: Number(item.source_page) || 1,
  };
}

export default function OffersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [packageFilter, setPackageFilter] = useState("all");
  const searchTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedSearch = normalizeProductSearchText(search.trim());
  const hasSearch = normalizedSearch.length >= 2;
  const today = useMemo(() => localDateKey(), []);

  const {
    data: storeReferenceRows = [],
    isLoading: loadingStoreReferences,
    error: storeReferencesError,
  } = useQuery<StoreReferenceRow[]>({
    queryKey: ["offers-store-references", user?.id],
    enabled: !!user && hasSearch,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await db
        .from("store_price_observations")
        .select(
          "id,product_id,supermarket,observed_date,raw_name,retail_price,normalized_retail_price,base_unit,package_quantity,package_unit,products(id,name)",
        )
        .eq("user_id", user!.id)
        .not("product_id", "is", null)
        .order("observed_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(600);

      if (error) throw error;
      return (data ?? []) as StoreReferenceRow[];
    },
  });

  useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setPackageFilter("all");
  }, [normalizedSearch]);

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

  const searchRequests = useMemo(() => {
    const requests = new Set(
      productSearchRequestVariants(normalizedSearch)
        .map((variant) => searchTokens(variant).join(" "))
        .filter(Boolean),
    );

    if (searchRequest) {
      requests.add(searchRequest);
    }

    if (isGenericPoncaSearch(normalizedSearch)) {
      PONCA_SEARCH_VARIANTS.forEach((variant) => requests.add(variant));
    }

    if (isPowderedDrinkSearch(normalizedSearch)) {
      powderedDrinkSearchRequests(normalizedSearch).forEach((variant) =>
        requests.add(variant),
      );
    }

    return [...requests];
  }, [normalizedSearch, searchRequest]);

  const searchRequestsKey = searchRequests.join("|");

  const {
    data: searchRows = [],
    isLoading: loadingSearchRows,
    error: searchRowsError,
  } = useQuery<SearchOfferItemRow[]>({
    queryKey: ["live-market-offer-search-v1", user?.id, today, searchRequestsKey],
    enabled:
      !!user &&
      hasSearch &&
      searchRequests.some((request) => request.length >= 2),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async ({ signal }) => {
      const responses = await Promise.all(
        searchRequests.map((request) =>
          db
            .rpc("search_offer_items_v1", {
              p_query: request,
              p_on_date: today,
              p_active_limit: 120,
              p_history_limit: 180,
            })
            .abortSignal(signal),
        ),
      );

      const rowsById = new Map<string, SearchOfferItemRow>();
      for (const { data, error } of responses) {
        if (error) throw error;
        for (const rawRow of data ?? []) {
          const row = sanitizeSearchOfferRow(rawRow);
          if (!row) continue;
          rowsById.set(row.id, row);
        }
      }

      return [...rowsById.values()];
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

  const directSearchProductIds = useMemo(() => {
    if (!hasSearch || !productContext) return [];

    return productContext.products
      .filter((product) =>
        productMatchesSearch(
          `${product.name} ${product.brand ?? ""} ${product.category ?? ""}`,
          normalizedSearch,
        ),
      )
      .map((product) => product.id)
      .sort();
  }, [hasSearch, normalizedSearch, productContext]);

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

  const referenceProductIds = useMemo(
    () => [...new Set([...relevantProductIds, ...directSearchProductIds])].sort(),
    [directSearchProductIds, relevantProductIds],
  );

  const referenceProductIdsKey = referenceProductIds.join(",");

  const { data: purchasePrices = [] } = useQuery<PurchasePriceRow[]>({
    queryKey: [
      "live-market-purchase-history-v2",
      user?.id,
      referenceProductIdsKey,
    ],
    enabled: !!user && referenceProductIds.length > 0,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await db
        .from("prices")
        .select(
          "product_id,price,date,supermarket,source,normalized_price,base_unit,package_quantity,package_unit,receipt_text",
        )
        .eq("user_id", user!.id)
        .in("product_id", referenceProductIds)
        .order("date", { ascending: false })
        .limit(800)
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
      .flatMap((entry) => {
        try {
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

          return [{
            ...entry,
            product,
            verdict,
          }];
        } catch (error) {
          console.error("Ignoring offer that failed analysis", entry.item?.id, error);
          return [];
        }
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

  const matchingStoreReferences = useMemo(() => {
    if (!hasSearch) return [];

    const queryFamily = queryOfferFamily(normalizedSearch);

    return storeReferenceRows.filter((row) => {
      if (
        !productMatchesSearch(
          `${row.raw_name} ${row.products?.name ?? ""}`,
          normalizedSearch,
        )
      ) {
        return false;
      }

      return familyMatchesIntent(storeReferenceFamily(row), queryFamily);
    });
  }, [hasSearch, normalizedSearch, storeReferenceRows]);

  const bestStoreReference = useMemo(() => {
    if (!matchingStoreReferences.length) return null;

    return [...matchingStoreReferences].sort((a, b) => {
      const aReference = storeReferenceValue(a);
      const bReference = storeReferenceValue(b);

      if (
        aReference &&
        bReference &&
        aReference.baseUnit === bReference.baseUnit &&
        Math.abs(aReference.value - bReference.value) > 0.0001
      ) {
        return aReference.value - bReference.value;
      }

      const packageDiff = Number(a.retail_price) - Number(b.retail_price);
      if (Math.abs(packageDiff) > 0.0001) return packageDiff;

      return String(b.observed_date).localeCompare(String(a.observed_date));
    })[0];
  }, [matchingStoreReferences]);

  const bestStoreReferenceValue = useMemo(
    () => (bestStoreReference ? storeReferenceValue(bestStoreReference) : null),
    [bestStoreReference],
  );

  const productById = useMemo(
    () =>
      new Map(
        (productContext?.products ?? []).map((product) => [product.id, product]),
      ),
    [productContext],
  );

  const matchingReceiptReferences = useMemo(() => {
    if (!directSearchProductIds.length) return [];
    const wanted = new Set(directSearchProductIds);
    const queryFamily = queryOfferFamily(normalizedSearch);

    return purchasePrices
      .filter((row) => {
        if (row.source !== "receipt" || !wanted.has(row.product_id)) {
          return false;
        }

        const product = productById.get(row.product_id);
        if (!product) return false;

        return familyMatchesIntent(productReferenceFamily(product), queryFamily);
      })
      .sort((a, b) =>
        String(b.date ?? "").localeCompare(String(a.date ?? "")),
      );
  }, [
    directSearchProductIds,
    normalizedSearch,
    productById,
    purchasePrices,
  ]);

  const latestReceiptReference = matchingReceiptReferences[0] ?? null;

  const latestReceiptReferenceValue = useMemo(
    () =>
      latestReceiptReference
        ? purchaseReferenceValue(
            latestReceiptReference,
            productById.get(latestReceiptReference.product_id),
          )
        : null,
    [latestReceiptReference, productById],
  );

  const latestReceiptProduct = latestReceiptReference
    ? productById.get(latestReceiptReference.product_id) ?? null
    : null;

  const reference360 = useMemo(() => {
    const candidates: Array<{
      source: "receipt" | "shelf";
      value: number;
      baseUnit: "kg" | "l" | "un";
      date: string;
    }> = [];

    for (const row of matchingReceiptReferences) {
      const reference = purchaseReferenceValue(
        row,
        productById.get(row.product_id),
      );
      if (!reference) continue;

      candidates.push({
        source: "receipt",
        value: reference.value,
        baseUnit: reference.baseUnit,
        date: String(row.date ?? ""),
      });
    }

    for (const row of matchingStoreReferences) {
      const reference = storeReferenceValue(row);
      if (!reference) continue;

      candidates.push({
        source: "shelf",
        value: reference.value,
        baseUnit: reference.baseUnit,
        date: String(row.observed_date ?? ""),
      });
    }

    if (!candidates.length) return null;

    const unitCounts = candidates.reduce(
      (acc, item) => {
        acc[item.baseUnit] += 1;
        return acc;
      },
      { kg: 0, l: 0, un: 0 },
    );

    const baseUnit = (Object.entries(unitCounts).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0] ?? "un") as "kg" | "l" | "un";

    const comparable = candidates
      .filter((item) => item.baseUnit === baseUnit)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);

    const value = medianValue(comparable.map((item) => item.value));
    if (!value) return null;

    return {
      value,
      baseUnit,
      count: comparable.length,
      receiptCount: comparable.filter((item) => item.source === "receipt").length,
      shelfCount: comparable.filter((item) => item.source === "shelf").length,
      values: comparable.map((item) => item.value),
    };
  }, [matchingReceiptReferences, matchingStoreReferences, productById]);

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

  const bestCurrentOffer = useMemo(() => {
    if (!analyzed.length) return null;

    return [...analyzed].sort((a, b) => {
      if (a.candidate.baseUnit === b.candidate.baseUnit) {
        const normalizedDiff =
          a.candidate.normalizedPrice - b.candidate.normalizedPrice;
        if (Math.abs(normalizedDiff) > 0.0001) return normalizedDiff;
      }

      return a.candidate.price - b.candidate.price;
    })[0];
  }, [analyzed]);

  const currentVsReference = useMemo(() => {
    if (!bestCurrentOffer || !reference360) return null;
    if (bestCurrentOffer.candidate.baseUnit !== reference360.baseUnit) {
      return null;
    }

    const current = bestCurrentOffer.candidate.normalizedPrice;
    if (!Number.isFinite(current) || current <= 0 || reference360.value <= 0) {
      return null;
    }

    return {
      current,
      diffPct: ((current - reference360.value) / reference360.value) * 100,
    };
  }, [bestCurrentOffer, reference360]);

  const currentVsStore = useMemo(() => {
    if (!bestCurrentOffer || !bestStoreReference) return null;

    const storeReference = storeReferenceValue(bestStoreReference);
    if (
      !storeReference ||
      bestCurrentOffer.candidate.baseUnit !== storeReference.baseUnit
    ) {
      return null;
    }

    const current = bestCurrentOffer.candidate.normalizedPrice;
    const previous = storeReference.value;
    if (!Number.isFinite(current) || current <= 0) return null;

    const diffPct = ((current - previous) / previous) * 100;

    return {
      current,
      previous,
      diffPct,
      currentIsBetter: current < previous - 0.0001,
      storeIsBetter: previous < current - 0.0001,
    };
  }, [bestCurrentOffer, bestStoreReference]);

  const decisionReference = useMemo(() => {
    if (!reference360) return null;

    const central = reference360.value;
    const historical = reference360.values;

    let low =
      historical.length >= 4
        ? percentileValue(historical, 0.25)
        : central * 0.95;
    let high =
      historical.length >= 4
        ? percentileValue(historical, 0.75)
        : central * 1.05;

    if (!Number.isFinite(low) || low <= 0) low = central * 0.95;
    if (!Number.isFinite(high) || high <= 0) high = central * 1.05;

    const waitAbove = Math.max(high, central * 1.08);

    return {
      central,
      low,
      high,
      waitAbove,
      baseUnit: reference360.baseUnit,
    };
  }, [reference360]);

  const networkReferences = useMemo(() => {
    type NetworkReference = {
      retailer: string;
      price: number;
      normalized: number;
      baseUnit: "kg" | "l" | "un";
      source: "cupom" | "gôndola";
      date: string;
      productId: string | null;
      packageLabel: string | null;
    };

    const candidates: NetworkReference[] = [];

    for (const row of matchingReceiptReferences) {
      const reference = purchaseReferenceValue(
        row,
        productById.get(row.product_id),
      );
      if (!reference || !row.supermarket) continue;
      if (reference360 && reference.baseUnit !== reference360.baseUnit) continue;

      candidates.push({
        retailer: canonicalRetailerName(row.supermarket) || row.supermarket,
        price: Number(row.price),
        normalized: reference.value,
        baseUnit: reference.baseUnit,
        source: "cupom",
        date: String(row.date ?? ""),
        productId: row.product_id,
        packageLabel: receiptHistoricalPackageLabel(
          row,
          productById.get(row.product_id),
        ),
      });
    }

    for (const row of matchingStoreReferences) {
      const reference = storeReferenceValue(row);
      if (!reference || !row.supermarket) continue;
      if (reference360 && reference.baseUnit !== reference360.baseUnit) continue;

      candidates.push({
        retailer: canonicalRetailerName(row.supermarket) || row.supermarket,
        price: Number(row.retail_price),
        normalized: reference.value,
        baseUnit: reference.baseUnit,
        source: "gôndola",
        date: String(row.observed_date ?? ""),
        productId: row.product_id,
        packageLabel: receiptHistoricalPackageLabel(
          row,
          productById.get(row.product_id),
        ),
      });
    }

    const bestByRetailer = new Map<string, NetworkReference>();
    for (const candidate of candidates) {
      const key = normalizeSearchText(candidate.retailer);
      const current = bestByRetailer.get(key);

      if (
        !current ||
        candidate.normalized < current.normalized - 0.0001 ||
        (Math.abs(candidate.normalized - current.normalized) <= 0.0001 &&
          candidate.date > current.date)
      ) {
        bestByRetailer.set(key, candidate);
      }
    }

    return [...bestByRetailer.values()]
      .sort((a, b) => {
        const priceDiff = a.normalized - b.normalized;
        if (Math.abs(priceDiff) > 0.0001) return priceDiff;
        return b.date.localeCompare(a.date);
      })
      .slice(0, 6);
  }, [
    matchingReceiptReferences,
    matchingStoreReferences,
    productById,
    reference360,
  ]);

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
    explicitSearchFamily === "fish" ||
    explicitSearchFamily === "sugar" ||
    explicitSearchFamily === "salt";

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

  const packageFilterOptions = useMemo(() => {
    const options = new Map<
      string,
      {
        label: string;
        count: number;
        baseUnit: "kg" | "l" | "un";
        baseQuantity: number;
      }
    >();

    for (const entry of analyzed) {
      const label = packageLabel(entry.item);
      if (!label) continue;

      const packageInfo = entry.candidate.packageInfo;
      const baseUnit = entry.candidate.baseUnit;
      const baseQuantity =
        packageInfo &&
        Number.isFinite(packageInfo.baseQuantity) &&
        packageInfo.baseQuantity > 0
          ? packageInfo.baseQuantity
          : Number.POSITIVE_INFINITY;

      const current = options.get(label);
      options.set(label, {
        label,
        count: (current?.count ?? 0) + 1,
        baseUnit,
        baseQuantity: current?.baseQuantity ?? baseQuantity,
      });
    }

    return [...options.values()].sort((a, b) => {
      const unitOrder = { l: 0, kg: 1, un: 2 } as const;
      const unitDiff = unitOrder[a.baseUnit] - unitOrder[b.baseUnit];
      if (unitDiff !== 0) return unitDiff;

      const quantityDiff = a.baseQuantity - b.baseQuantity;
      if (Math.abs(quantityDiff) > 0.0001) return quantityDiff;

      return a.label.localeCompare(b.label, "pt-BR");
    });
  }, [analyzed]);

  const visibleAnalyzed = useMemo(
    () =>
      packageFilter === "all"
        ? analyzed
        : analyzed.filter((entry) => packageLabel(entry.item) === packageFilter),
    [analyzed, packageFilter],
  );

  const listedAnalyzed = useMemo(() => {
    if (!bestCurrentOffer || resultFamilyCount !== 1) return visibleAnalyzed;
    return visibleAnalyzed.filter(
      (entry) => entry.item.id !== bestCurrentOffer.item.id,
    );
  }, [bestCurrentOffer, resultFamilyCount, visibleAnalyzed]);

  const activeFlyerCount = activeFlyers.length;
  const allActiveOfferCount = activeOfferCount;

  return (
    <div className="page-container !pb-24 mx-auto w-full max-w-3xl">
      <header className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          Preço 360
        </p>
        <h1 className="mt-1 text-[clamp(2rem,9vw,3rem)] font-extrabold leading-none tracking-tight">
          Ofertas
        </h1>
      </header>

      <ProductSearchBar
        ref={searchInputRef}
        className="mb-4"
        value={searchInput}
        placeholder="Busque sabão em pó, água sanitária, café..."
        autoFocus
        onChange={(value, source) => {
          setSearchInput(value);

          if (searchTimerRef.current !== null) {
            window.clearTimeout(searchTimerRef.current);
            searchTimerRef.current = null;
          }

          if (source === "voice") {
            setSearch(value);
            return;
          }

          searchTimerRef.current = window.setTimeout(() => {
            setSearch(value);
          }, 140);
        }}
      />

      {hasSearch &&
        !isLoading &&
        !error &&
        bestCurrentOffer &&
        resultFamilyCount === 1 && (() => {
          const quickItem = bestCurrentOffer.item;
          const quickCandidate = bestCurrentOffer.candidate;
          const quickPack = packageLabel(quickItem);
          const quickRetailer =
            canonicalRetailerName(bestCurrentOffer.flyer?.retailer) ||
            bestCurrentOffer.flyer?.retailer ||
            "Supermercado";
          const quickUnit =
            quickCandidate.baseUnit !== "un"
              ? formatNormalizedPrice(
                  quickCandidate.normalizedPrice,
                  quickCandidate.baseUnit,
                )
              : null;

          return (
            <section
              id={`best-current-offer-${quickItem.id}`}
              className="mb-4 rounded-[22px] border-2 border-primary/50 bg-primary/[0.10] p-3 shadow-[0_8px_28px_hsl(var(--primary)/0.08)]"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-primary">
                  Melhor custo-benefício agora
                </p>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {analyzed.length} oferta{analyzed.length === 1 ? "" : "s"} vigente{analyzed.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                <ProductVisual
                  name={quickItem.raw_name}
                  category={bestCurrentOffer.product?.category}
                  imageUrl={quickItem.image_url}
                  compact
                />

                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <AdaptiveProductName
                        text={standardizedOfferName(quickItem, bestCurrentOffer.family)}
                        className="font-extrabold"
                        minPx={12}
                        maxPx={16}
                        desktopMaxPx={17}
                      />
                    </div>
                    {quickPack && (
                      <span className="shrink-0 rounded-md border border-primary/20 bg-background/35 px-1.5 py-0.5 text-[10px] font-extrabold">
                        {quickPack}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-background/30 px-2 py-0.5 font-bold">
                      <Store className="h-3.5 w-3.5 text-primary" />
                      {quickRetailer}
                    </span>
                    {quickUnit && (
                      <span className="font-semibold text-muted-foreground">
                        menor preço por {quickCandidate.baseUnit === "l" ? "litro" : quickCandidate.baseUnit === "kg" ? "kg" : "unidade"}
                      </span>
                    )}
                  </div>

                  {currentVsStore?.currentIsBetter && (
                    <p className="mt-1.5 text-[10px] font-bold text-primary">
                      {Math.abs(currentVsStore.diffPct).toFixed(0)}% mais barato que o preço de gôndola registrado
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-xl font-black leading-none text-primary">
                    {brl(quickCandidate.price)}
                  </p>
                  {quickUnit && (
                    <p className="mt-1 text-[11px] font-extrabold text-primary/90">
                      {quickUnit}
                    </p>
                  )}
                </div>
              </div>
            </section>
          );
        })()}

      {hasSearch &&
        !isLoading &&
        !error &&
        bestCurrentOffer &&
        resultFamilyCount > 1 && (
          <section className="mb-4 rounded-2xl border border-primary/30 bg-primary/[0.07] p-3">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-primary">
              Há mais de um tipo de produto
            </p>
            <p className="mt-1 text-sm font-bold">
              Compare o melhor de cada tipo abaixo
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Para não comparar produtos diferentes como se fossem equivalentes, o Preço 360 destaca o melhor dentro de cada família.
            </p>
          </section>
        )}



      {hasSearch &&
        !isLoading &&
        !error &&
        analyzed.length > 1 &&
        packageFilterOptions.length > 1 && (
          <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setPackageFilter("all")}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                packageFilter === "all"
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card/40 text-muted-foreground"
              }`}
            >
              Todos ({analyzed.length})
            </button>
            {packageFilterOptions.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setPackageFilter(option.label)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  packageFilter === option.label
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-card/40 text-muted-foreground"
                }`}
              >
                {option.label} ({option.count})
              </button>
            ))}
          </div>
        )}

      {hasSearch && storeReferencesError && (
        <p className="mb-3 text-[10px] text-muted-foreground">
          As ofertas vigentes foram carregadas, mas a referência de gôndola não pôde ser consultada agora.
        </p>
      )}

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

      {!isLoading &&
        !error &&
        activeFlyerCount === 0 &&
        !(hasSearch && (bestStoreReference || latestReceiptReference || reference360)) && (
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
        analyzed.length === 0 &&
        !bestStoreReference && !latestReceiptReference && !reference360 && (
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
                {hasSearch
                  ? resultFamilyCount === 1 && bestCurrentOffer
                    ? "Outras ofertas vigentes"
                    : "Ofertas vigentes"
                  : "Melhores oportunidades vigentes"}
              </p>
              <p className="text-sm font-bold">
                {resultFamilyCount === 1 && bestCurrentOffer
                  ? packageFilter === "all"
                    ? `${listedAnalyzed.length} outra(s) oferta(s)`
                    : `${listedAnalyzed.length} outra(s) de ${visibleAnalyzed.length} nesta embalagem`
                  : packageFilter === "all"
                    ? `${analyzed.length} oferta(s) encontrada(s)`
                    : `${visibleAnalyzed.length} de ${analyzed.length} oferta(s)`}
              </p>
            </div>
            {hasSearch &&
              analyzed[0] &&
              (!isBroadFamilySearch || resultFamilyCount > 1) && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary">
                  {isBroadFamilySearch
                    ? "Melhor por tipo"
                    : "Melhor preço"}
                </span>
              )}
          </div>

          {listedAnalyzed.slice(0, hasSearch ? 30 : 12).map((entry, index) => {
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
            const displayTitle = standardizedOfferName(item, entry.family);
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
              : hasSearch && resultFamilyCount !== 1 && index === 0;
            const bestLabel = isBroadFamilySearch
              ? `Melhor compra agora · ${familyLabel(entry.family)}`
              : "Melhor compra agora";

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

      {hasSearch &&
        !isLoading &&
        !error &&
        !loadingStoreReferences &&
        !bestCurrentOffer &&
        (latestReceiptReference || bestStoreReference || reference360) && (
          <>
            <section className="mt-4 mb-4 rounded-[22px] border border-border bg-card/45 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10">
                  <Clock3 className="h-5 w-5 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[clamp(1.2rem,5vw,1.6rem)] font-extrabold leading-tight tracking-tight">
                    Sem oferta vigente
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Não há promoção ativa para “{normalizedSearch}”. Use o histórico abaixo como referência.
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {latestReceiptReference && (
                  <div className="rounded-2xl border border-border/80 bg-background/35 p-3">
                    <div className="flex items-center gap-2">
                      <ReceiptText className="h-4 w-4 text-sky-400" />
                      <p className="text-xs font-extrabold">Último pago</p>
                    </div>
                    <p className="mt-2 text-xl font-black">
                      {latestReceiptReferenceValue &&
                      latestReceiptReferenceValue.baseUnit !== "un"
                        ? formatNormalizedPrice(
                            latestReceiptReferenceValue.value,
                            latestReceiptReferenceValue.baseUnit,
                          )
                        : brl(Number(latestReceiptReference.price))}
                    </p>
                    {latestReceiptReferenceValue &&
                      latestReceiptReferenceValue.baseUnit !== "un" && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Embalagem: {brl(Number(latestReceiptReference.price))}
                        </p>
                      )}
                    <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                      {canonicalRetailerName(latestReceiptReference.supermarket) ||
                        latestReceiptReference.supermarket ||
                        "Supermercado"}
                      {latestReceiptReference.date
                        ? ` · ${dateBr(latestReceiptReference.date)}`
                        : ""}
                    </p>
                    {latestReceiptProduct?.name && (
                      <div className="mt-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.10em] text-muted-foreground">
                          Produto
                        </p>
                        <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
                          {latestReceiptProduct.name}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {bestStoreReference && (
                  <div className="rounded-2xl border border-border/80 bg-background/35 p-3">
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4 text-violet-400" />
                      <p className="text-xs font-extrabold">Preço de gôndola</p>
                    </div>
                    <p className="mt-2 text-xl font-black">
                      {bestStoreReferenceValue
                        ? formatNormalizedPrice(
                            bestStoreReferenceValue.value,
                            bestStoreReferenceValue.baseUnit,
                          )
                        : brl(Number(bestStoreReference.retail_price))}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                      {canonicalRetailerName(bestStoreReference.supermarket) ||
                        bestStoreReference.supermarket}
                      {bestStoreReference.observed_date
                        ? ` · ${dateBr(bestStoreReference.observed_date)}`
                        : ""}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  const productId =
                    bestStoreReference?.product_id ??
                    latestReceiptReference?.product_id ??
                    networkReferences[0]?.productId ??
                    null;

                  navigate(
                    productId
                      ? `/search?product=${encodeURIComponent(productId)}`
                      : "/search",
                  );
                }}
                className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3 text-left font-bold transition hover:border-primary/40 hover:bg-primary/[0.10]"
              >
                <Camera className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  Registrar preço de gôndola e comparar
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </button>
            </section>

            {networkReferences.length > 1 && (
              <section className="mb-4">
                <h2 className="mb-2 text-lg font-extrabold tracking-tight">
                  Outros preços anteriores
                </h2>
                <div className="space-y-2">
                  {networkReferences.map((reference) => (
                    <div
                      key={`${reference.retailer}-${reference.source}-${reference.date}`}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-card/35 p-3"
                    >
                      <RetailerLogo
                        retailer={reference.retailer}
                        className="shrink-0"
                        imageClassName="h-10 w-16"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          {reference.retailer}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {reference.source} · {dateBr(reference.date)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-extrabold">
                          {reference.baseUnit === "un"
                            ? brl(reference.price)
                            : formatNormalizedPrice(
                                reference.normalized,
                                reference.baseUnit,
                              )}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {reference.packageLabel
                            ? `${reference.packageLabel} · ${brl(reference.price)}`
                            : `Embalagem ${brl(reference.price)}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

      {hasSearch &&
        !isLoading &&
        !error &&
        !loadingStoreReferences &&
        !!bestCurrentOffer &&
        (latestReceiptReference || bestStoreReference || reference360) && (
          <>
            <section className="mt-4 mb-4 rounded-[22px] border border-primary/35 bg-gradient-to-br from-primary/[0.08] via-card to-card p-3 sm:p-4 shadow-sm">
              <div className="mb-3 flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[clamp(1.35rem,5.5vw,1.85rem)] font-extrabold leading-tight tracking-tight">
                    Resumo para decidir
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Oferta vigente + gôndola + seu histórico
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="min-w-0 rounded-2xl border border-border/80 bg-background/35 p-2.5 sm:p-3">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Store className="h-4 w-4 shrink-0 text-violet-400" />
                    <p className="text-[10px] font-extrabold leading-tight sm:text-xs">
                      Gôndola
                    </p>
                  </div>
                  <p className="text-[9px] text-muted-foreground sm:text-[10px]">
                    preço normal
                  </p>
                  {bestStoreReference ? (
                    <>
                      <p className="mt-2 text-[clamp(.95rem,4vw,1.35rem)] font-black leading-none">
                        {bestStoreReferenceValue
                          ? formatNormalizedPrice(
                              bestStoreReferenceValue.value,
                              bestStoreReferenceValue.baseUnit,
                            )
                          : brl(Number(bestStoreReference.retail_price))}
                      </p>
                      <p className="mt-1 truncate text-[9px] text-muted-foreground sm:text-[10px]">
                        {canonicalRetailerName(bestStoreReference.supermarket) ||
                          bestStoreReference.supermarket}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                      Sem registro
                    </p>
                  )}
                </div>

                <div className="min-w-0 rounded-2xl border border-border/80 bg-background/35 p-2.5 sm:p-3">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <ReceiptText className="h-4 w-4 shrink-0 text-sky-400" />
                    <p className="text-[10px] font-extrabold leading-tight sm:text-xs">
                      Histórico
                    </p>
                  </div>
                  <p className="text-[9px] text-muted-foreground sm:text-[10px]">
                    último pago
                  </p>
                  {latestReceiptReference ? (
                    <>
                      <p className="mt-2 text-[clamp(.95rem,4vw,1.35rem)] font-black leading-none">
                        {latestReceiptReferenceValue &&
                        latestReceiptReferenceValue.baseUnit !== "un"
                          ? formatNormalizedPrice(
                              latestReceiptReferenceValue.value,
                              latestReceiptReferenceValue.baseUnit,
                            )
                          : brl(Number(latestReceiptReference.price))}
                      </p>
                      <p className="mt-1 truncate text-[9px] text-muted-foreground sm:text-[10px]">
                        {canonicalRetailerName(latestReceiptReference.supermarket) ||
                          latestReceiptReference.supermarket ||
                          "Supermercado"}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                      Sem registro
                    </p>
                  )}
                </div>

                {bestCurrentOffer ? (
                  <button
                    type="button"
                    onClick={() => {
                      const target = document.getElementById(
                        `best-current-offer-${bestCurrentOffer.item.id}`,
                      );
                      if (!target) return;

                      target.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      });

                      window.setTimeout(() => {
                        target.animate(
                          [
                            {
                              boxShadow:
                                "0 0 0 0 hsl(var(--primary) / 0.55)",
                              transform: "scale(1)",
                            },
                            {
                              boxShadow:
                                "0 0 0 10px hsl(var(--primary) / 0.12)",
                              transform: "scale(1.01)",
                            },
                            {
                              boxShadow:
                                "0 0 0 0 hsl(var(--primary) / 0)",
                              transform: "scale(1)",
                            },
                          ],
                          {
                            duration: 900,
                            easing: "ease-out",
                          },
                        );
                      }, 350);
                    }}
                    className="min-w-0 rounded-2xl border border-primary/45 bg-primary/[0.12] p-2.5 text-left transition hover:bg-primary/[0.16] active:scale-[0.99] sm:p-3"
                    aria-label="Ver a oferta com melhor preço agora"
                  >
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <Trophy className="h-4 w-4 shrink-0 text-primary" />
                      <p className="text-[10px] font-extrabold leading-tight text-primary sm:text-xs">
                        Melhor agora
                      </p>
                      <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-primary/80" />
                    </div>
                    <p className="text-[9px] text-muted-foreground sm:text-[10px]">
                      toque para ver a oferta
                    </p>
                    <p className="mt-2 text-[clamp(.95rem,4vw,1.35rem)] font-black leading-none text-primary">
                      {bestCurrentOffer.candidate.baseUnit !== "un"
                        ? formatNormalizedPrice(
                            bestCurrentOffer.candidate.normalizedPrice,
                            bestCurrentOffer.candidate.baseUnit,
                          )
                        : brl(bestCurrentOffer.candidate.price)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[9px] font-extrabold leading-tight text-foreground sm:text-[10px]">
                      {standardizedOfferName(
                        bestCurrentOffer.item,
                        bestCurrentOffer.family,
                      )}
                    </p>
                    <p className="mt-1 truncate text-[9px] font-bold text-primary/90 sm:text-[10px]">
                      {canonicalRetailerName(bestCurrentOffer.flyer?.retailer) ||
                        bestCurrentOffer.flyer?.retailer ||
                        "Supermercado"}
                    </p>
                  </button>
                ) : (
                  <div className="min-w-0 rounded-2xl border border-border/80 bg-background/35 p-2.5 sm:p-3">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="text-[10px] font-extrabold leading-tight sm:text-xs">
                        Melhor agora
                      </p>
                    </div>
                    <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                      Sem oferta
                    </p>
                  </div>
                )}
              </div>

              {decisionReference && (
                <div className="mt-2.5 flex items-start gap-2.5 rounded-2xl border border-border/80 bg-background/30 p-2.5 sm:p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">
                      Bom preço até{" "}
                      {formatNormalizedPrice(
                        decisionReference.central,
                        decisionReference.baseUnit,
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      Acima de{" "}
                      {formatNormalizedPrice(
                        decisionReference.waitAbove,
                        decisionReference.baseUnit,
                      )}
                      , vale esperar outra oferta se a compra puder aguardar.
                    </p>
                  </div>
                </div>
              )}
            </section>

            {networkReferences.length > 0 && (
              <section className="mb-4">
                <h2 className="mb-2 text-[clamp(1.25rem,5.5vw,1.75rem)] font-extrabold tracking-tight">
                  Referências por supermercado
                </h2>

                <div className="space-y-2">
                  {networkReferences.map((reference, index) => {
                    const withinNormal =
                      !!reference360 &&
                      reference.baseUnit === reference360.baseUnit &&
                      reference.normalized <= reference360.value * 1.05;
                    const status =
                      index === 0
                        ? {
                            label: "melhor referência histórica",
                            className:
                              "border-primary/35 bg-primary/10 text-primary",
                            Icon: Trophy,
                          }
                        : withinNormal
                          ? {
                              label: "faixa normal",
                              className:
                                "border-slate-500/30 bg-slate-500/10 text-muted-foreground",
                              Icon: TrendingUp,
                            }
                          : {
                              label: "mais caro",
                              className:
                                "border-red-500/35 bg-red-500/10 text-red-400",
                              Icon: TrendingUp,
                            };
                    const StatusIcon = status.Icon;

                    return (
                      <button
                        key={`${reference.retailer}-${reference.source}-${reference.date}`}
                        type="button"
                        onClick={() =>
                          reference.productId
                            ? navigate(
                                `/search?product=${encodeURIComponent(
                                  reference.productId,
                                )}`,
                              )
                            : navigate("/search")
                        }
                        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card/45 p-3 text-left transition hover:border-primary/30 hover:bg-muted/40"
                      >
                        <RetailerLogo
                          retailer={reference.retailer}
                          className="shrink-0"
                          imageClassName="h-12 w-20"
                        />

                        <div className="min-w-0 flex-1">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${status.className}`}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </span>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="font-extrabold">
                            {formatNormalizedPrice(
                              reference.normalized,
                              reference.baseUnit,
                            )}
                          </p>
                          <p className="text-[10px] text-muted-foreground sm:text-xs">
                            {reference.packageLabel
                              ? `${reference.packageLabel} · ${brl(reference.price)}`
                              : `Embalagem ${brl(reference.price)}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground sm:text-xs">
                            {reference.source} · {dateBr(reference.date)}
                          </p>
                        </div>

                        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <button
              type="button"
              onClick={() => {
                const productId =
                  bestStoreReference?.product_id ??
                  latestReceiptReference?.product_id ??
                  networkReferences[0]?.productId ??
                  null;

                navigate(
                  productId
                    ? `/search?product=${encodeURIComponent(productId)}`
                    : "/search",
                );
              }}
              className="mb-4 flex h-13 min-h-13 w-full items-center gap-3 rounded-2xl border border-border bg-card/30 px-4 py-3 text-left font-bold transition hover:border-primary/30 hover:bg-muted/40"
            >
              <Camera className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                Comparar com o preço que encontrei agora
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </button>
          </>
        )}
    </div>
  );
}
