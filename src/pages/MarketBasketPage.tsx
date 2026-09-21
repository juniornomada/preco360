import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  ShoppingBasket,
  Plus,
  Mic,
  Sparkles,
  Split,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { basketNeedsCatalog, genericBasketFamilies } from "@/lib/flyerAnalysis";
import { requiresAppActivation } from "@/lib/clubOfferRules";

const db = supabase as any;
const LEGACY_STORAGE_KEY = "preco360-basket-selection-v2";

type BasketSelection = Record<string, number>;

function basketStorageKey(userId: string) {
  return `${LEGACY_STORAGE_KEY}:${userId}`;
}

function sanitizeBasketSelection(value: unknown): BasketSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const next: BasketSelection = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const quantity = Number(rawValue);
    if (!key || !Number.isFinite(quantity) || quantity <= 0) continue;
    next[key] = Math.max(1, Math.min(99, Math.round(quantity)));
  }
  return next;
}

function readStoredBasket(key: string) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? sanitizeBasketSelection(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

type Flyer = {
  id: string;
  retailer: string;
  valid_from: string;
  valid_to: string;
};

type Offer = {
  id: string;
  flyer_id: string;
  product_id: string | null;
  raw_name: string;
  normalized_name: string | null;
  advertised_price: number;
  normalized_price: number;
  club_price?: boolean | null;
  club_advertised_price?: number | null;
  base_unit: "kg" | "l" | "un";
  package_quantity: number | null;
  package_unit: string | null;
  offer_notes?: string[] | null;
};

type OfferWithMarket = Offer & {
  retailer: string;
  validTo: string;
};

type Group = {
  key: string;
  label: string;
  baseUnit: "kg" | "l" | "un";
  offers: OfferWithMarket[];
  markets: string[];
  generic?: boolean;
  manual?: boolean;
  catalog?: boolean;
  category?: string;
  aliases?: string[];
  optionCount?: number;
};

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const unitLabel = (unit: "kg" | "l" | "un") => (unit === "l" ? "L" : unit);

function todayLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function dateBr(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[3] + "/" + match[2] + "/" + match[1] : value;
}

function fallbackKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function manualBasketKey(label: string) {
  return "m:" + encodeURIComponent(label.trim());
}

function manualBasketLabel(key: string) {
  if (!key.startsWith("m:")) return null;
  try {
    return decodeURIComponent(key.slice(2)).trim();
  } catch {
    return key.slice(2).trim();
  }
}

function containsVoicePhrase(text: string, phrase: string) {
  const source = " " + fallbackKey(text) + " ";
  const target = " " + fallbackKey(phrase) + " ";
  return source.includes(target);
}

function voiceCatalogNeeds(transcript: string) {
  const normalized = " " + fallbackKey(transcript) + " ";
  const candidates: Array<{
    key: string;
    label: string;
    baseUnit: "kg" | "l" | "un";
    start: number;
    end: number;
    length: number;
  }> = [];

  for (const need of basketNeedsCatalog) {
    for (const variant of [need.label, ...need.aliases]) {
      const phrase = fallbackKey(variant);
      if (!phrase) continue;
      const needle = " " + phrase + " ";
      let from = 0;
      while (from < normalized.length) {
        const index = normalized.indexOf(needle, from);
        if (index < 0) break;
        candidates.push({
          key: need.key,
          label: need.label,
          baseUnit: need.baseUnit,
          start: index + 1,
          end: index + 1 + phrase.length,
          length: phrase.length,
        });
        from = index + needle.length;
      }
    }
  }

  candidates.sort((a, b) => b.length - a.length || a.start - b.start);

  const occupied: Array<[number, number]> = [];
  const selected: typeof candidates = [];
  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    if (seenKeys.has(candidate.key)) continue;
    const overlaps = occupied.some(
      ([start, end]) => candidate.start < end && candidate.end > start,
    );
    if (overlaps) continue;
    occupied.push([candidate.start, candidate.end]);
    selected.push(candidate);
    seenKeys.add(candidate.key);
  }

  return selected.sort((a, b) => a.start - b.start);
}

function manualVoiceItems(transcript: string) {
  let value = transcript
    .replace(
      /\b(?:adiciona|adicione|adicionar|coloca|coloque|bota|bote|inclui|inclua)\b/gi,
      " ",
    )
    .replace(/\b(?:pra mim|para mim|na cesta|a cesta|por favor)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return [];

  return value
    .split(/\s*[,;]\s*|\s+e\s+/i)
    .map((item) => item.replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").trim())
    .filter((item) => item.length >= 2);
}

function compactOfferName(label: string, rawName: string) {
  const labelWords = label.trim().split(/\s+/);
  const rawWords = rawName.trim().split(/\s+/);

  let sharedPrefix = 0;
  while (
    sharedPrefix < labelWords.length &&
    sharedPrefix < rawWords.length &&
    fallbackKey(labelWords[sharedPrefix]) === fallbackKey(rawWords[sharedPrefix])
  ) {
    sharedPrefix += 1;
  }

  if (sharedPrefix === 0) return rawName;

  let compact = rawWords.slice(sharedPrefix).join(" ").trim();

  if (labelWords.length === 1) {
    compact = compact.replace(/^(?:de|da|do|das|dos)\s+/i, "");
  }

  return compact || rawName;
}

function validClubPrice(offer: OfferWithMarket) {
  const regular = Number(offer.advertised_price);
  const club = Number(offer.club_advertised_price);
  return Number.isFinite(club) &&
    club > 0 &&
    (!Number.isFinite(regular) || regular <= 0 || club <= regular)
    ? club
    : null;
}

function effectiveAdvertisedPrice(offer: OfferWithMarket) {
  return validClubPrice(offer) ?? Number(offer.advertised_price);
}

function normalizedPriceLabel(offer: OfferWithMarket) {
  if (offer.base_unit === "un") return null;
  const comparable = comparablePrice(offer);
  if (!Number.isFinite(comparable) || comparable <= 0) return null;
  return brl(comparable) + "/" + unitLabel(offer.base_unit);
}

function comparablePrice(offer: OfferWithMarket) {
  const effective = effectiveAdvertisedPrice(offer);

  if (offer.base_unit === "kg" || offer.base_unit === "l") {
    const baseQuantity = packageBaseQuantity(offer);
    if (Number.isFinite(baseQuantity) && baseQuantity > 0) {
      return effective / baseQuantity;
    }

    const regular = Number(offer.advertised_price);
    const normalized = Number(offer.normalized_price);
    if (
      Number.isFinite(normalized) &&
      normalized > 0 &&
      Number.isFinite(regular) &&
      regular > 0
    ) {
      return normalized * (effective / regular);
    }
  }

  return effective;
}

function packageBaseQuantity(offer: OfferWithMarket) {
  const quantity = Number(offer.package_quantity);
  const unit = (offer.package_unit ?? "").toLowerCase();
  if (!Number.isFinite(quantity) || quantity <= 0) return 1;

  if (offer.base_unit === "kg") {
    if (unit === "g") return quantity / 1000;
    if (unit === "kg") return quantity;
  }

  if (offer.base_unit === "l") {
    if (unit === "ml") return quantity / 1000;
    if (unit === "l") return quantity;
  }

  return 1;
}

function packageLabel(offer: OfferWithMarket) {
  const quantity = Number(offer.package_quantity);
  const unit = offer.package_unit ?? "";
  if (Number.isFinite(quantity) && quantity > 0 && unit) {
    const formatted = Number.isInteger(quantity)
      ? String(quantity)
      : quantity.toLocaleString("pt-BR");
    return formatted + unit;
  }
  return offer.base_unit === "un" ? "1 un" : "1 embalagem";
}

function desiredBaseQuantity(group: Group, packageCount: number) {
  const reference = [...group.offers].sort(compareOfferValue)[0];
  if (!reference) return packageCount;
  return packageBaseQuantity(reference) * packageCount;
}

function equivalentGroupCost(
  group: Group,
  offer: OfferWithMarket,
  packageCount: number,
) {
  if (offer.base_unit === "kg" || offer.base_unit === "l") {
    return comparablePrice(offer) * desiredBaseQuantity(group, packageCount);
  }
  return effectiveAdvertisedPrice(offer) * packageCount;
}

function compareOfferValue(a: OfferWithMarket, b: OfferWithMarket) {
  return (
    comparablePrice(a) - comparablePrice(b) ||
    Number(a.advertised_price) - Number(b.advertised_price)
  );
}

// Deploy refresh: no functional change.
export default function MarketBasketPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<BasketSelection>({});
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [showItems, setShowItems] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("");
  const speechRecognitionRef = useRef<any>(null);
  const lastSyncedSelectionRef = useRef<string | null>(null);
  const activeBasketUserRef = useRef<string | null>(null);
  const basketSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    return () => {
      try {
        speechRecognitionRef.current?.abort?.();
      } catch {
        // Browser speech recognition cleanup is best-effort.
      }
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    const userId = user?.id ?? null;
    activeBasketUserRef.current = userId;
    setSelectionHydrated(false);

    const hydrateSelection = async () => {
      const userStorageKey = userId
        ? basketStorageKey(userId)
        : LEGACY_STORAGE_KEY;
      const userLocal = readStoredBasket(userStorageKey);
      const legacyLocal =
        userId && Object.keys(userLocal).length === 0
          ? readStoredBasket(LEGACY_STORAGE_KEY)
          : {};
      const localSelection =
        Object.keys(userLocal).length > 0 ? userLocal : legacyLocal;

      if (cancelled) return;

      if (!userId) {
        setSelected(localSelection);
        lastSyncedSelectionRef.current = JSON.stringify(localSelection);
        setSelectionHydrated(true);
        return;
      }

      // Show the local cache immediately while the cloud copy is loaded.
      if (Object.keys(localSelection).length > 0) {
        setSelected(localSelection);
      }

      const { data, error } = await db
        .from("user_baskets")
        .select("selection,updated_at")
        .eq("user_id", userId)
        .maybeSingle();

      if (cancelled || activeBasketUserRef.current !== userId) return;

      if (error) {
        setSelected(localSelection);
        // Keep this null so the next local change retries the cloud sync.
        lastSyncedSelectionRef.current = null;
        setSelectionHydrated(true);
        return;
      }

      if (data) {
        const cloudSelection = sanitizeBasketSelection(data.selection);
        const serialized = JSON.stringify(cloudSelection);
        setSelected(cloudSelection);
        lastSyncedSelectionRef.current = serialized;

        try {
          localStorage.setItem(userStorageKey, serialized);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // Local cache is optional; Supabase remains the source of truth.
        }

        setSelectionHydrated(true);
        return;
      }

      // First cloud sync: migrate the old desktop/browser basket if one exists.
      if (Object.keys(localSelection).length > 0) {
        const serialized = JSON.stringify(localSelection);
        const { error: migrationError } = await db
          .from("user_baskets")
          .upsert(
            { user_id: userId, selection: localSelection },
            { onConflict: "user_id" },
          );

        if (cancelled || activeBasketUserRef.current !== userId) return;

        if (!migrationError) {
          lastSyncedSelectionRef.current = serialized;
          try {
            localStorage.setItem(userStorageKey, serialized);
            localStorage.removeItem(LEGACY_STORAGE_KEY);
          } catch {
            // Local cache is optional.
          }
        } else {
          lastSyncedSelectionRef.current = null;
        }

        setSelected(localSelection);
      } else {
        // Do not create an empty cloud row here. This prevents a new device
        // from overwriting a basket that still only exists in another browser's
        // legacy localStorage before that browser gets a chance to migrate it.
        setSelected({});
        lastSyncedSelectionRef.current = JSON.stringify({});
      }

      setSelectionHydrated(true);
    };

    void hydrateSelection();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (authLoading || !selectionHydrated) return;

    const userId = user?.id ?? null;
    const cleanSelection = sanitizeBasketSelection(selected);
    const serialized = JSON.stringify(cleanSelection);
    const localKey = userId ? basketStorageKey(userId) : LEGACY_STORAGE_KEY;

    try {
      localStorage.setItem(localKey, serialized);
    } catch {
      // Local cache is optional.
    }

    if (!userId || serialized === lastSyncedSelectionRef.current) return;

    const timer = window.setTimeout(() => {
      basketSaveQueueRef.current = basketSaveQueueRef.current.then(async () => {
        if (activeBasketUserRef.current !== userId) return;

        const { error } = await db
          .from("user_baskets")
          .upsert(
            { user_id: userId, selection: cleanSelection },
            { onConflict: "user_id" },
          );

        if (!error && activeBasketUserRef.current === userId) {
          lastSyncedSelectionRef.current = serialized;
        }
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [selected, selectionHydrated, authLoading, user?.id]);

  const today = todayLocal();

  const { data: flyers = [], isLoading: loadingFlyers } = useQuery<Flyer[]>({
    queryKey: ["active-flyers-basket", user?.id, today],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyers")
        .select("id,retailer,valid_from,valid_to")
        .lte("valid_from", today)
        .gte("valid_to", today)
        .order("retailer");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const flyerMap = useMemo(
    () => new Map(flyers.map((flyer) => [flyer.id, flyer])),
    [flyers],
  );

  const { data: offers = [], isLoading: loadingOffers } = useQuery<Offer[]>({
    queryKey: ["active-flyer-items-basket", user?.id, flyers.map((f) => f.id).join(",")],
    queryFn: async () => {
      const ids = flyers.map((flyer) => flyer.id);
      if (!ids.length) return [];
      const { data, error } = await db
        .from("flyer_items")
        .select("id,flyer_id,product_id,raw_name,normalized_name,advertised_price,normalized_price,club_price,club_advertised_price,base_unit,package_quantity,package_unit,offer_notes")
        .in("flyer_id", ids)
        .gt("advertised_price", 0);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !loadingFlyers,
  });

  const groups = useMemo<Group[]>(() => {
    const specificMap = new Map<string, Group>();
    const genericMap = new Map<string, Group>();

    const addOffer = (
      map: Map<string, Group>,
      key: string,
      label: string,
      offer: OfferWithMarket,
      generic = false,
    ) => {
      const current = map.get(key);
      if (current) {
        current.offers.push(offer);
        if (!current.markets.includes(offer.retailer)) {
          current.markets.push(offer.retailer);
        }
        return;
      }

      map.set(key, {
        key,
        label,
        baseUnit: offer.base_unit,
        offers: [offer],
        markets: [offer.retailer],
        generic,
      });
    };

    for (const offer of offers) {
      const flyer = flyerMap.get(offer.flyer_id);
      if (!flyer?.retailer) continue;

      const enriched: OfferWithMarket = {
        ...offer,
        retailer: flyer.retailer,
        validTo: flyer.valid_to,
      };

      const identityKey = offer.product_id
        ? "p:" + offer.product_id
        : "n:" + (offer.normalized_name || fallbackKey(offer.raw_name));

      if (identityKey && identityKey !== "n:") {
        addOffer(
          specificMap,
          identityKey + "|u:" + offer.base_unit,
          offer.raw_name,
          enriched,
        );
      }

      // A generic family represents the need, not a specific SKU. Most offers
      // belong to one generic family; some can also expose a useful brand-level
      // need (for example Nescau em pó) without leaving the broader
      // "Achocolatado em pó" comparison.
      for (const family of genericBasketFamilies(offer.raw_name)) {
        addOffer(
          genericMap,
          "g:" + family.key + "|u:" + offer.base_unit,
          family.label,
          enriched,
          true,
        );
      }
    }

    for (const need of basketNeedsCatalog) {
      const prefix = "g:" + need.key + "|u:";
      const existing = [...genericMap.values()].find((group) =>
        group.key.startsWith(prefix),
      );

      if (existing) {
        existing.catalog = true;
        existing.category = need.category;
        existing.aliases = need.aliases;
        continue;
      }

      genericMap.set(prefix + need.baseUnit, {
        key: prefix + need.baseUnit,
        label: need.label,
        baseUnit: need.baseUnit,
        offers: [],
        markets: [],
        generic: true,
        catalog: true,
        category: need.category,
        aliases: need.aliases,
      });
    }

    const genericGroups = [...genericMap.values()].map((group) => ({
      ...group,
      optionCount: new Set(
        group.offers.map((offer) => fallbackKey(offer.raw_name)),
      ).size,
    }));

    const specificGroups = [...specificMap.values()];

    return [...genericGroups, ...specificGroups].sort((a, b) => {
      if (Boolean(a.catalog) !== Boolean(b.catalog)) {
        return a.catalog ? -1 : 1;
      }
      if (Boolean(a.generic) !== Boolean(b.generic)) {
        return a.generic ? -1 : 1;
      }
      return a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" });
    });
  }, [offers, flyerMap]);

  const visibleGroups = useMemo(() => {
    const q = fallbackKey(search);
    if (q.length < 2) return [];

    const tokens = q.split(/\s+/);
    return groups
      .filter((group) => {
        const haystack = fallbackKey(
          [
            group.label,
            group.category ?? "",
            ...(group.aliases ?? []),
          ].join(" "),
        );
        return tokens.every((token) => haystack.includes(token));
      })
      .sort((a, b) => {
        const aLabel = fallbackKey(a.label);
        const bLabel = fallbackKey(b.label);
        const aAliases = (a.aliases ?? []).map(fallbackKey);
        const bAliases = (b.aliases ?? []).map(fallbackKey);
        const aExact = aLabel === q || aAliases.includes(q) ? 1 : 0;
        const bExact = bLabel === q || bAliases.includes(q) ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        const aStarts =
          aLabel.startsWith(q) || aAliases.some((alias) => alias.startsWith(q))
            ? 1
            : 0;
        const bStarts =
          bLabel.startsWith(q) || bAliases.some((alias) => alias.startsWith(q))
            ? 1
            : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;

        if (Boolean(a.catalog) !== Boolean(b.catalog)) {
          return a.catalog ? -1 : 1;
        }

        if (Boolean(a.generic) !== Boolean(b.generic)) {
          return a.generic ? -1 : 1;
        }

        return a.label.localeCompare(b.label, "pt-BR", {
          sensitivity: "base",
        });
      })
      .slice(0, 30);
  }, [groups, search]);

  const selectedGroups = useMemo(() => {
    const normal = groups
      .filter((group) => (selected[group.key] ?? 0) > 0)
      .map((group) => ({ ...group, quantity: selected[group.key] }));

    const manual = Object.entries(selected)
      .filter(([key, quantity]) => key.startsWith("m:") && quantity > 0)
      .map(([key, quantity]) => {
        const label = manualBasketLabel(key) || "Item manual";
        const wanted = fallbackKey(label);
        const wantedTokens = wanted.split(/\s+/).filter(Boolean);

        const compatibleGroups = groups.filter((group) => {
          const candidate = fallbackKey(group.label);
          if (!candidate) return false;
          return wantedTokens.every((token) => candidate.includes(token));
        });

        const offersById = new Map<string, OfferWithMarket>();
        for (const group of compatibleGroups) {
          for (const offer of group.offers) {
            offersById.set(offer.id, offer);
          }
        }
        const matchedOffers = [...offersById.values()];
        const markets = [...new Set(matchedOffers.map((offer) => offer.retailer))];

        return {
          key,
          label,
          baseUnit: matchedOffers[0]?.base_unit ?? ("un" as const),
          offers: matchedOffers,
          markets,
          generic: true,
          manual: true,
          optionCount: matchedOffers.length,
          quantity,
        };
      });

    return [...normal, ...manual];
  }, [groups, selected]);

  const comparison = useMemo(() => {
    if (!selectedGroups.length) {
      return { markets: [] as any[], bestSingle: null as any, split: null as any };
    }

    const retailerNames = [...new Set(flyers.map((flyer) => flyer.retailer).filter(Boolean))];
    const bestOfferByGroup = new Map<string, OfferWithMarket>();

    for (const group of selectedGroups) {
      const best = [...group.offers].sort(compareOfferValue)[0];
      if (best) bestOfferByGroup.set(group.key, best);
    }

    const markets = retailerNames.map((retailer) => {
      let total = 0;
      let covered = 0;
      let bestComparableTotal = 0;
      let premiumVsBest = 0;
      const missingItems: string[] = [];
      const rows: Array<{
        key: string;
        label: string;
        generic: boolean;
        quantity: number;
        offer: OfferWithMarket;
        subtotal: number;
      }> = [];

      for (const group of selectedGroups) {
        const candidates = group.offers
          .filter((offer) => offer.retailer === retailer)
          .sort(compareOfferValue);
        const offer = candidates[0] ?? null;
        const best = bestOfferByGroup.get(group.key) ?? null;

        if (offer) {
          covered += 1;
          const offerCost = equivalentGroupCost(group, offer, group.quantity);
          total += offerCost;
          rows.push({
            key: group.key,
            label: group.label,
            generic: Boolean(group.generic),
            quantity: group.quantity,
            offer,
            subtotal: offerCost,
          });
          if (best) {
            const bestCost = equivalentGroupCost(group, best, group.quantity);
            bestComparableTotal += bestCost;
            premiumVsBest += offerCost - bestCost;
          }
        } else {
          missingItems.push(group.label);
        }
      }

      return {
        retailer,
        total,
        covered,
        missing: selectedGroups.length - covered,
        complete: covered === selectedGroups.length,
        premiumVsBest,
        premiumPct: bestComparableTotal > 0 ? (premiumVsBest / bestComparableTotal) * 100 : 0,
        rows,
        missingItems,
      };
    });

    const completeMarkets = markets
      .filter((market) => market.complete)
      .sort((a, b) => a.total - b.total);

    const practicalMarkets = [...markets].sort(
      (a, b) =>
        b.covered - a.covered ||
        a.premiumPct - b.premiumPct ||
        a.total - b.total,
    );

    const splitRows = selectedGroups
      .map((group) => {
        const offer = bestOfferByGroup.get(group.key);
        if (!offer) return null;
        return {
          key: group.key,
          label: group.label,
          quantity: group.quantity,
          offer,
          subtotal: equivalentGroupCost(group, offer, group.quantity),
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        label: string;
        quantity: number;
        offer: OfferWithMarket;
        subtotal: number;
      }>;

    const splitTotal = splitRows.reduce((sum, row) => sum + row.subtotal, 0);
    const splitMarkets = [...new Set(splitRows.map((row) => row.offer.retailer))];

    return {
      markets,
      bestSingle: completeMarkets[0] ?? practicalMarkets[0] ?? null,
      split: { total: splitTotal, rows: splitRows, markets: splitMarkets },
    };
  }, [selectedGroups, flyers]);

  const bestSingle = comparison.bestSingle;
  const split = comparison.split;
  const splitIsComplete =
    Boolean(split) && split.rows.length === selectedGroups.length;
  const unpricedSelectedCount =
    selectedGroups.length - (split?.rows.length ?? 0);

  const normalizedManualSearch = fallbackKey(search);
  const exactVisibleGroup = visibleGroups.some(
    (group) =>
      fallbackKey(group.label) === normalizedManualSearch ||
      (group.aliases ?? []).some(
        (alias) => fallbackKey(alias) === normalizedManualSearch,
      ),
  );
  const manualAlreadySelected = Object.keys(selected).some((key) => {
    const label = manualBasketLabel(key);
    return label && fallbackKey(label) === normalizedManualSearch;
  });
  const canAddManual =
    search.trim().length >= 2 &&
    normalizedManualSearch.length >= 2 &&
    !exactVisibleGroup &&
    !manualAlreadySelected;
  const rankedMarkets = useMemo(
    () =>
      [...comparison.markets].sort(
        (a, b) =>
          Number(b.complete) - Number(a.complete) ||
          b.covered - a.covered ||
          a.total - b.total,
      ),
    [comparison.markets],
  );

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = { ...current };
      if ((next[key] ?? 0) > 0) delete next[key];
      else next[key] = 1;
      return next;
    });

  const addToBasket = (key: string) => {
    setSelected((current) => ({
      ...current,
      [key]: Math.max(1, current[key] ?? 0),
    }));
    setSearch("");
    setShowItems(false);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const addManualToBasket = () => {
    const label = search.trim().replace(/\s+/g, " ");
    if (label.length < 2) return;

    setSelected((current) => {
      const normalized = fallbackKey(label);
      const existingManualKey = Object.keys(current).find((key) => {
        const existingLabel = manualBasketLabel(key);
        return existingLabel && fallbackKey(existingLabel) === normalized;
      });

      if (existingManualKey) {
        return {
          ...current,
          [existingManualKey]: Math.max(1, current[existingManualKey] ?? 0),
        };
      }

      return {
        ...current,
        [manualBasketKey(label)]: 1,
      };
    });

    setSearch("");
    setShowItems(false);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const applyVoiceCommand = (transcript: string) => {
    const catalogMatches = voiceCatalogNeeds(transcript);
    const labels: string[] = [];

    setSelected((current) => {
      const next = { ...current };

      if (catalogMatches.length > 0) {
        for (const match of catalogMatches) {
          const key = `g:${match.key}|u:${match.baseUnit}`;
          next[key] = Math.max(1, next[key] ?? 0);
          labels.push(match.label);
        }
      } else {
        for (const item of manualVoiceItems(transcript)) {
          const normalized = fallbackKey(item);
          const existing = Object.keys(next).find((key) => {
            const label = manualBasketLabel(key);
            return label && fallbackKey(label) === normalized;
          });
          const key = existing ?? manualBasketKey(item);
          next[key] = Math.max(1, next[key] ?? 0);
          labels.push(item);
        }
      }

      return next;
    });

    setVoiceTranscript(transcript);
    setSearch("");
    setShowItems(false);

    if (labels.length) {
      setVoiceMessage(
        `Adicionado${labels.length > 1 ? "s" : ""}: ${labels.join(", ")}.`,
      );
    } else {
      setVoiceMessage(
        "Não consegui identificar produtos nessa frase. Tente falar os itens separados por pequenas pausas.",
      );
    }
  };

  const toggleVoiceInput = () => {
    if (listening) {
      speechRecognitionRef.current?.stop?.();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceMessage(
        "O reconhecimento de voz não está disponível neste navegador. Você ainda pode digitar os itens normalmente.",
      );
      return;
    }

    const recognition = new SpeechRecognition();
    speechRecognitionRef.current = recognition;
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setVoiceMessage("Ouvindo… fale os produtos normalmente.");
    };

    recognition.onresult = (event: any) => {
      const transcript = String(
        event?.results?.[0]?.[0]?.transcript ?? "",
      ).trim();
      if (transcript) applyVoiceCommand(transcript);
    };

    recognition.onerror = (event: any) => {
      const code = String(event?.error ?? "");
      setVoiceMessage(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Permita o acesso ao microfone para adicionar produtos por voz."
          : "Não consegui entender o áudio. Tente novamente falando um pouco mais devagar.",
      );
    };

    recognition.onend = () => {
      setListening(false);
      speechRecognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch {
      setListening(false);
      setVoiceMessage("Não foi possível iniciar o microfone agora. Tente novamente.");
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (value.trim().length >= 2) {
      setShowItems(true);
    }
  };

  const changeQty = (key: string, delta: number) =>
    setSelected((current) => {
      const next = { ...current };
      const value = Math.max(0, Math.min(99, (next[key] ?? 0) + delta));
      if (!value) delete next[key];
      else next[key] = value;
      return next;
    });

  return (
    <div className="page-container !pb-40 mx-auto w-full max-w-3xl">
      <header className="mb-4">
        <button
          type="button"
          onClick={() => navigate("/offers")}
          className="mb-3 flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para Ofertas
        </button>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Cesta</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Qual mercado vale mais a pena?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monte sua lista por necessidade — inclusive sem escolher marca — e compare os tabloides vigentes.
        </p>
      </header>

      {(loadingFlyers || loadingOffers) && (
        <Card className="mb-4">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Carregando promoções vigentes…
          </CardContent>
        </Card>
      )}

      {!loadingFlyers && flyers.length < 2 && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <p className="font-semibold">Importe pelo menos dois tabloides vigentes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Hoje há {flyers.length} supermercado(s) com tabloide vigente.
            </p>
          </CardContent>
        </Card>
      )}

      {selectedGroups.length > 0 && split && split.rows.length > 0 && (
        <div className="mb-4 space-y-3">
          <details className="rounded-xl border border-primary/25 bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Split className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-tight">
                  {splitIsComplete
                    ? "Cesta completa pelo menor preço"
                    : "Menor preço dos itens encontrados"}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Cada item com preço é comprado onde está mais barato · {split.markets.length} mercado{split.markets.length === 1 ? "" : "s"}
                  {!splitIsComplete && unpricedSelectedCount > 0
                    ? ` · ${unpricedSelectedCount} item(ns) sem preço`
                    : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                  Total
                </p>
                <p className="text-lg font-extrabold leading-none text-primary">
                  {brl(split.total)}
                </p>
              </div>
            </summary>
            <div className="space-y-2 border-t p-3">
              <p className="rounded-lg bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Este é o custo da <span className="font-semibold text-foreground">cesta inteira</span>.
                Os valores “Parcial” abaixo somam somente os itens encontrados no tabloide de cada supermercado.
              </p>
              {split.rows.map((row) => (
                <div key={row.key} className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 p-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {row.quantity}× {row.label}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({row.quantity} pacote{row.quantity > 1 ? "s" : ""})
                      </span>
                    </p>
                    {row.offer.raw_name !== row.label && (
                      <p className="mt-0.5 text-xs font-medium text-primary">
                        Comprar: {compactOfferName(row.label, row.offer.raw_name)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {row.offer.retailer} · válido até {dateBr(row.offer.validTo)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold">{brl(row.subtotal)}</p>
                    {normalizedPriceLabel(row.offer) ? (
                      <>
                        <p className="text-[11px] text-muted-foreground">
                          equivalente · {normalizedPriceLabel(row.offer)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {validClubPrice(row.offer)
                            ? "clube " +
                              brl(effectiveAdvertisedPrice(row.offer)) +
                              (requiresAppActivation(
                                row.offer.retailer,
                                row.offer.offer_notes,
                              )
                                ? " · ativar desconto APP"
                                : "") +
                              " · normal " +
                              brl(Number(row.offer.advertised_price))
                            : "embalagem " +
                              brl(Number(row.offer.advertised_price))}
                        </p>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </details>

          {bestSingle && rankedMarkets.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Quanto custa em cada supermercado
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    preços do tabloide
                  </span>
                </div>
                <div className="mt-2 divide-y divide-border/60">
                  {rankedMarkets.map((market) => {
                    const completeDifference =
                      bestSingle.complete && market.complete
                        ? Math.max(0, market.total - bestSingle.total)
                        : null;
                    const completeDifferencePct =
                      completeDifference !== null && bestSingle.total > 0
                        ? (completeDifference / bestSingle.total) * 100
                        : null;

                    return (
                      <div
                        key={"quick-" + market.retailer}
                        className="flex items-center justify-between gap-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p
                            className={
                              "truncate font-semibold " +
                              (market.retailer === bestSingle.retailer
                                ? "text-primary"
                                : "text-foreground")
                            }
                          >
                            {market.retailer}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {market.covered}/{selectedGroups.length} itens com preço vigente
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={
                              "font-bold " +
                              (market.retailer === bestSingle.retailer
                                ? "text-primary"
                                : "text-foreground")
                            }
                          >
                            {market.complete ? "Total: " : "Parcial: "}
                            {brl(market.total)}
                          </p>
                          {market.complete ? (
                            completeDifference !== null && completeDifference > 0 ? (
                              <p className="text-[10px] text-muted-foreground">
                                +{brl(completeDifference)}
                                {completeDifferencePct !== null
                                  ? " · +" +
                                    completeDifferencePct
                                      .toFixed(1)
                                      .replace(".", ",") +
                                    "%"
                                  : ""}
                              </p>
                            ) : (
                              <p className="text-[10px] font-medium text-primary">
                                cesta completa
                              </p>
                            )
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  “Parcial” soma apenas os itens com preço vigente naquele mercado. Não representa o custo da cesta completa.
                  Se a diferença for pequena, distância, combustível e tempo podem tornar outro mercado mais conveniente.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <ShoppingBasket className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="font-bold">Minha lista</p>
              <p className="text-xs text-muted-foreground">
                {selectedGroups.length} item(ns) selecionado(s)
              </p>
            </div>
            {selectedGroups.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected({})}>Limpar</Button>
            )}
          </div>

          {selectedGroups.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Na cesta
              </p>
              {selectedGroups.map((group) => {
                const qty = selected[group.key] ?? 0;
                const reference = [...group.offers].sort(compareOfferValue)[0];
                return (
                  <div
                    key={"basket-" + group.key}
                    className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <Check className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{group.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {!reference
                          ? `${qty}× item · sem preço vigente`
                          : group.generic
                            ? `${qty}× referência de ${reference ? packageLabel(reference) : "embalagem"} · qualquer marca`
                            : `${qty} pacote${qty > 1 ? "s" : ""} · ${reference ? packageLabel(reference) : "embalagem"}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-lg border bg-background p-1">
                      <button
                        type="button"
                        aria-label={"Diminuir quantidade de " + group.label}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-lg active:bg-muted"
                        onClick={() => changeQty(group.key, -1)}
                      >−</button>
                      <span className="min-w-7 text-center text-sm font-bold">{qty}</span>
                      <button
                        type="button"
                        aria-label={"Aumentar quantidade de " + group.label}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-lg active:bg-muted"
                        onClick={() => changeQty(group.key, 1)}
                      >+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="relative mt-3">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Leite em pó, papel higiênico, azeite..."
              className="h-11 pl-9 pr-12"
            />
            <button
              type="button"
              onClick={toggleVoiceInput}
              aria-label={listening ? "Parar reconhecimento de voz" : "Adicionar produtos por voz"}
              title={listening ? "Parar microfone" : "Adicionar produtos por voz"}
              className={
                "absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg border transition " +
                (listening
                  ? "border-primary bg-primary text-primary-foreground animate-pulse"
                  : "border-border bg-background text-primary hover:bg-primary/10")
              }
            >
              <Mic className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Digite ou toque no microfone e fale naturalmente. Ex.: “adiciona leite, açúcar, feijão, biscoito recheado e bombom”.
          </p>

          {(voiceTranscript || voiceMessage) && (
            <div className="mt-2 rounded-lg border bg-muted/30 px-3 py-2">
              {voiceTranscript && (
                <p className="text-[10px] text-muted-foreground">
                  Você disse: “{voiceTranscript}”
                </p>
              )}
              {voiceMessage && (
                <p className="mt-0.5 text-xs font-medium text-foreground">
                  {voiceMessage}
                </p>
              )}
            </div>
          )}

          {canAddManual && (
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-auto min-h-10 w-full justify-start whitespace-normal px-3 py-2 text-left"
              onClick={addManualToBasket}
            >
              <Plus className="mr-2 h-4 w-4 shrink-0 text-primary" />
              <span>
                Adicionar <span className="font-bold">“{search.trim()}”</span> à cesta
                <span className="ml-1 text-muted-foreground">mesmo sem preço</span>
              </span>
            </Button>
          )}

          {manualAlreadySelected && search.trim().length >= 2 && (
            <p className="mt-2 text-xs font-medium text-primary">
              Esse item manual já está na sua cesta.
            </p>
          )}

          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between text-sm font-semibold"
            onClick={() => setShowItems((value) => !value)}
          >
            Escolher produtos e necessidades
            {showItems ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showItems && (
            <div className="mt-3 max-h-[54vh] space-y-2 overflow-y-auto pr-1">
              {visibleGroups.map((group) => {
                const qty = selected[group.key] ?? 0;
                const best = [...group.offers].sort(compareOfferValue)[0];
                return (
                  <div
                    key={group.key}
                    className={
                      "rounded-xl border p-3 transition " +
                      (qty
                        ? "border-primary/50 bg-primary/10 ring-1 ring-primary/20"
                        : "bg-card")
                    }
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={
                          "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition " +
                          (qty
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground")
                        }
                      >
                        {qty ? <Check className="h-5 w-5" /> : <ShoppingBasket className="h-4 w-4" />}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="font-semibold leading-snug">{group.label}</p>
                          {group.generic && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                              Qualquer marca
                            </span>
                          )}
                          {group.catalog && !best && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                              Sem preço
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {!best
                            ? `${group.category ?? "Necessidade"} · sem preço vigente`
                            : (
                              (group.generic
                                ? `${group.optionCount ?? group.offers.length} opção(ões) em ${group.markets.length} mercado(s)`
                                : `${group.markets.length} mercado(s)`) +
                              " · " +
                              (normalizedPriceLabel(best)
                                ? "melhor custo " + normalizedPriceLabel(best) +
                                  " · " +
                                  (validClubPrice(best)
                                    ? "clube " +
                                      brl(effectiveAdvertisedPrice(best)) +
                                      (requiresAppActivation(
                                        best.retailer,
                                        best.offer_notes,
                                      )
                                        ? " · ativar desconto APP"
                                        : "")
                                    : "embalagem " + brl(Number(best.advertised_price)))
                                : "melhor oferta " + brl(effectiveAdvertisedPrice(best)))
                            )}
                        </p>
                        {best && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {group.generic
                              ? `Melhor agora: ${best.raw_name} · ${best.retailer}`
                              : `1 pacote = ${packageLabel(best)}`}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3">
                      {qty > 0 ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-primary">
                            Na cesta · {group.generic
                              ? `${qty} referência${qty > 1 ? "s" : ""}`
                              : `${qty} pacote${qty > 1 ? "s" : ""}`}
                          </span>
                          <button
                            type="button"
                            className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
                            onClick={() => toggle(group.key)}
                          >
                            Remover
                          </button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          className="h-10 w-full"
                          onClick={() => addToBasket(group.key)}
                        >
                          <ShoppingBasket className="mr-2 h-4 w-4" />
                          Adicionar à cesta
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              {!loadingOffers && search.trim().length < 2 && (
                <div className="py-6 text-center">
                  <Search className="mx-auto h-6 w-6 text-primary" />
                  <p className="mt-2 text-sm font-medium">
                    Digite pelo menos 2 letras
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Assim a Cesta mostra somente os produtos relevantes e continua rápida no celular.
                  </p>
                </div>
              )}

              {!loadingOffers &&
                search.trim().length >= 2 &&
                visibleGroups.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhuma oferta vigente encontrada. Você ainda pode adicionar esse item manualmente à cesta acima.
                  </p>
                )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedGroups.length > 0 && comparison.markets.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="font-bold">Comparação por supermercado</h2>
          </div>
          {rankedMarkets.map((market) => {
            const isBestMarket = market.retailer === bestSingle?.retailer;

            return (
              <Card
                key={market.retailer}
                className={isBestMarket ? "border-primary/40 bg-primary/[0.03]" : ""}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-extrabold leading-tight text-primary">
                          {market.retailer}
                        </p>
                        {isBestMarket && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                            Melhor opção
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {market.covered}/{selectedGroups.length} itens encontrados
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="inline-block rounded-lg bg-primary/10 px-2.5 py-1 text-lg font-extrabold leading-none text-primary">
                        {brl(market.total)}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {market.complete
                          ? selectedGroups.some((group) => group.baseUnit !== "un")
                            ? "cesta equivalente por kg/L"
                            : "cesta promocional completa"
                          : `parcial · ${market.covered}/${selectedGroups.length} itens · ${market.missing} sem preço`}
                      </p>
                      {bestSingle?.complete &&
                        market.complete &&
                        market.retailer !== bestSingle.retailer && (
                          <p className="text-[10px] font-medium text-muted-foreground">
                            +{brl(Math.max(0, market.total - bestSingle.total))} vs. melhor cesta
                          </p>
                        )}
                    </div>
                  </div>

                  {!market.complete && market.missingItems?.length > 0 && (
                    <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-500">
                        Itens sem preço vigente neste mercado
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {market.missingItems.join(" · ")}
                      </p>
                    </div>
                  )}

                  {market.rows?.some((row: any) => row.generic) && (
                    <div className="mt-3 space-y-1.5 border-t pt-2.5">
                      {market.rows
                        .filter((row: any) => row.generic)
                        .map((row: any) => (
                          <div
                            key={market.retailer + "-" + row.key}
                            className="flex items-start justify-between gap-3 text-xs"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold">{row.label}</span>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {compactOfferName(row.label, row.offer.raw_name)}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="flex items-baseline justify-end gap-1.5 whitespace-nowrap font-semibold">
                                {validClubPrice(row.offer) &&
                                  requiresAppActivation(
                                    row.offer.retailer,
                                    row.offer.offer_notes,
                                  ) && (
                                    <span className="text-[9px] font-bold uppercase text-amber-500">
                                      ativar desconto APP
                                    </span>
                                  )}
                                <span>{brl(effectiveAdvertisedPrice(row.offer))}</span>
                              </p>
                              {normalizedPriceLabel(row.offer) && (
                                <p className="text-[10px] text-muted-foreground">
                                  {normalizedPriceLabel(row.offer)}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Para produtos específicos, a quantidade representa número de embalagens. Para necessidades
        genéricas (“leite em pó”, “molho de tomate”, etc.), a Cesta usa como referência o tamanho da
        melhor oferta vigente e compara marcas e embalagens diferentes por R$/kg ou R$/L.
        Quando existe preço-clube válido, ele é usado como seu preço efetivo tanto na embalagem
        quanto no R$/kg ou R$/L. Itens por unidade usam o preço da própria embalagem. O comparador usa
        somente preços dos tabloides importados e ainda vigentes. Itens adicionados manualmente podem
        permanecer na cesta sem preço; se uma oferta compatível aparecer depois, ela passa a ser usada
        automaticamente na comparação. Ausência de um item no tabloide não significa que o mercado não
        venda o produto — apenas que não temos um preço promocional válido para ele.
      </p>
    </div>
  );
}
