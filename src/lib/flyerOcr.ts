import { supabase } from "@/integrations/supabase/client";
import { normalizedUnitPrice, type BaseUnit, type FlyerCandidate, type PackageInfo } from "@/lib/flyerAnalysis";
import { readFlyerFileSmart as readFlyerLocal } from "@/lib/flyerOcrV6";

type Progress = (page: number, total: number, label: string) => void;

type VisionOffer = {
  product_name: string;
  brand: string | null;
  package_quantity: number | null;
  package_unit: string | null;
  price: number;
  price_basis_quantity: number;
  price_basis_unit: string;
  club_price: number | null;
  included_types: string[];
  excluded_types: string[];
  store_restrictions: string[];
  purchase_limit: string | null;
  notes: string[];
  source_page: number;
  confidence: number;
};

type VisionResponse = {
  ok?: boolean;
  engine?: string;
  model?: string;
  retailer?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  page_count?: number | null;
  offers?: VisionOffer[];
  error?: string;
  message?: string;
};

type RichCandidate = FlyerCandidate & {
  clubAdvertisedPrice?: number | null;
  includedTypes?: string[];
  excludedTypes?: string[];
  storeRestrictions?: string[];
  purchaseLimit?: string | null;
  offerNotes?: string[];
  extractionConfidence?: number;
  priceBasisQuantity?: number;
  priceBasisUnit?: string;
};

const money = (value: number) => `R$ ${value.toFixed(2).replace(".", ",")}`;

function packageInfo(quantity: number | null | undefined, rawUnit: string | null | undefined): PackageInfo | null {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0 || !rawUnit) return null;
  const unit = rawUnit.toLowerCase();
  if (unit === "g") return { quantity: q, unit: "g", baseUnit: "kg", baseQuantity: q / 1000 };
  if (unit === "kg") return { quantity: q, unit: "kg", baseUnit: "kg", baseQuantity: q };
  if (unit === "ml") return { quantity: q, unit: "ml", baseUnit: "l", baseQuantity: q / 1000 };
  if (unit === "l" || unit === "lt") return { quantity: q, unit: "l", baseUnit: "l", baseQuantity: q };
  if (["un", "und", "unid", "unidade"].includes(unit)) {
    return { quantity: q, unit: "un", baseUnit: "un", baseQuantity: q };
  }
  return null;
}

function displayPackage(offer: VisionOffer) {
  if (!offer.package_quantity || !offer.package_unit) return "";
  const quantity = Number(offer.package_quantity);
  const rendered = Number.isInteger(quantity) ? String(quantity) : String(quantity).replace(".", ",");
  return `${rendered}${offer.package_unit}`;
}

function displayName(offer: VisionOffer) {
  const pieces: string[] = [];
  const identity = offer.product_name.trim();
  const pkg = displayPackage(offer);
  pieces.push(pkg && !identity.toLowerCase().includes(pkg.toLowerCase()) ? `${identity} ${pkg}` : identity);

  if (offer.included_types?.length) pieces.push(`tipos: ${offer.included_types.join(", ")}`);
  if (offer.excluded_types?.length) pieces.push(`exceto: ${offer.excluded_types.join(", ")}`);
  if (Number(offer.club_price) > 0) pieces.push(`Clube ${money(Number(offer.club_price))}`);
  if (offer.purchase_limit?.trim()) pieces.push(`limite: ${offer.purchase_limit.trim()}`);
  if (offer.store_restrictions?.length) pieces.push(`lojas: ${offer.store_restrictions.join(", ")}`);
  for (const note of offer.notes ?? []) if (note?.trim()) pieces.push(note.trim());

  return pieces.filter(Boolean).join(" · ");
}

function toCandidate(offer: VisionOffer): RichCandidate | null {
  const price = Number(offer.price);
  const confidence = Number(offer.confidence);
  if (!offer.product_name?.trim() || !Number.isFinite(price) || price <= 0 || confidence < 0.72) return null;

  let pkg = packageInfo(offer.package_quantity, offer.package_unit);
  if (!pkg && offer.price_basis_unit && offer.price_basis_unit.toLowerCase() !== "un") {
    pkg = packageInfo(offer.price_basis_quantity, offer.price_basis_unit);
  }

  const normalized = normalizedUnitPrice(price, pkg);
  return {
    rawName: displayName(offer),
    price,
    packageInfo: pkg,
    normalizedPrice: normalized.normalizedPrice,
    baseUnit: normalized.baseUnit as BaseUnit,
    clubPrice: Number(offer.club_price) > 0,
    sourcePage: Math.max(1, Math.trunc(Number(offer.source_page) || 1)),
    clubAdvertisedPrice: Number(offer.club_price) > 0 ? Number(offer.club_price) : null,
    includedTypes: offer.included_types ?? [],
    excludedTypes: offer.excluded_types ?? [],
    storeRestrictions: offer.store_restrictions ?? [],
    purchaseLimit: offer.purchase_limit ?? null,
    offerNotes: offer.notes ?? [],
    extractionConfidence: confidence,
    priceBasisQuantity: Number(offer.price_basis_quantity) || 1,
    priceBasisUnit: offer.price_basis_unit || "un",
  };
}

async function visionErrorDetails(error: any) {
  try {
    const response = error?.context;
    if (response && typeof response.clone === "function") {
      const payload = await response.clone().json();
      return payload?.message || payload?.error || error?.message || "Falha na análise visual";
    }
  } catch {
    // ignore response decoding errors
  }
  return error?.message || "Falha na análise visual";
}

async function readWithVision(file: File, onProgress: Progress) {
  onProgress(1, 1, "Analisando visualmente o tabloide com IA…");
  const form = new FormData();
  form.append("file", file, file.name || "tabloide");
  const { data, error } = await supabase.functions.invoke<VisionResponse>("analyze-flyer", { body: form });

  if (error) {
    const details = await visionErrorDetails(error);
    throw new Error(`Análise visual indisponível: ${details}`);
  }
  if (!data?.ok) {
    throw new Error(`Análise visual indisponível: ${data?.message || data?.error || "resposta inválida do servidor"}`);
  }
  if (!Array.isArray(data.offers)) {
    throw new Error("Análise visual indisponível: o servidor não retornou a lista de ofertas.");
  }

  const candidates = data.offers.map(toCandidate).filter((item): item is RichCandidate => !!item);
  if (!candidates.length) {
    throw new Error("A análise visual terminou, mas não retornou nenhuma oferta confiável.");
  }

  const pageCount = Math.max(1, Number(data.page_count) || Math.max(...candidates.map((item) => item.sourcePage), 1));
  const textByPage = Array.from({ length: pageCount }, (_, index) =>
    candidates
      .filter((item) => item.sourcePage === index + 1)
      .map((item) => `${item.rawName} ${item.price.toFixed(2)}`)
      .join("\n"),
  );
  const metaText = [
    data.retailer ?? "",
    data.valid_from && data.valid_to ? `${data.valid_from} a ${data.valid_to}` : "",
  ].filter(Boolean).join("\n");

  onProgress(pageCount, pageCount, `${candidates.length} ofertas lidas por IA`);
  return { textByPage, metaText, pageCount, candidates, engine: data.engine ?? "openai-vision", model: data.model };
}

export async function readFlyerFileSmart(file: File, onProgress: Progress) {
  // Radar 360 must never silently replace a failed visual extraction with OCR.
  // That used to make a broken IA integration look like a successful import of the same
  // low-quality 23 OCR rows. Surface the real error so it can be fixed instead.
  return readWithVision(file, onProgress);
}

// Explicit fallback kept only for future/manual recovery flows.
export async function readFlyerFileLocal(file: File, onProgress: Progress) {
  return readFlyerLocal(file, onProgress);
}
