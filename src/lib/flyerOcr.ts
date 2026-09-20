import { supabase } from "@/integrations/supabase/client";
import { normalizedUnitPrice, type BaseUnit, type FlyerCandidate, type PackageInfo } from "@/lib/flyerAnalysis";
import { readFlyerFileSmart as readFlyerLocal } from "@/lib/flyerOcrV6";

type Progress = (page: number, total: number, label: string) => void;

export type VisionOffer = {
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
  image_box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  image_box_confidence?: number | null;
  confidence: number;
};

export type VisionResponse = {
  ok?: boolean;
  engine?: string;
  model?: string;
  retailer?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  page_count?: number | null;
  refined_pages?: number[];
  deduplicated_count?: number;
  offers?: VisionOffer[];
  error?: string;
  message?: string;
};

type RichCandidate = FlyerCandidate & {
  brand?: string | null;
  clubAdvertisedPrice?: number | null;
  includedTypes?: string[];
  excludedTypes?: string[];
  storeRestrictions?: string[];
  purchaseLimit?: string | null;
  offerNotes?: string[];
  extractionConfidence?: number;
  priceBasisQuantity?: number;
  priceBasisUnit?: string;
  imageBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  imageBoxConfidence?: number | null;
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

function normalizeCommonProduceOcr(value: string) {
  return value
    .replace(/\bBeteroba\b/gi, "Beterraba")
    .replace(/\bBeterroba\b/gi, "Beterraba")
    .replace(/\bAbeterraba\b/gi, "Beterraba")
    .replace(/\bMamão Formoso\b/gi, "Mamão Formosa");
}

function displayName(offer: VisionOffer) {
  let identity = offer.product_name.trim();
  const brand = offer.brand?.trim() ?? "";

  // Gemini sometimes separates the brand from product_name. For multi-brand offers,
  // do not append "Riviera / Patéko" again when both brand names are already present.
  const identityKey = normalizeIdentity(identity);
  const brandParts = brand
    .split(/[\/|,]/)
    .map((part) => normalizeIdentity(part))
    .filter(Boolean);
  const brandAlreadyPresent =
    brandParts.length > 0 && brandParts.every((part) => identityKey.includes(part));

  if (brand && !brandAlreadyPresent && !identityKey.includes(normalizeIdentity(brand))) {
    identity = `${identity} ${brand}`;
  }

  const pkg = displayPackage(offer);
  if (pkg && !normalizeIdentity(identity).includes(normalizeIdentity(pkg))) {
    identity = `${identity} ${pkg}`;
  }

  return normalizeCommonProduceOcr(identity.replace(/\s+/g, " ").trim());
}

function normalizeIdentity(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeOfferNameForDedupe(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d)\s*[,\.]\s*(\d)/g, "$1.$2")
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|lt|un|und|unid|unidade)\b/g, " ")
    .replace(
      /\b(?:de|da|do|das|dos|tipo|tipos|sabor|sabores|pacote|embalagem|unidade|unidades|un|und|kg|g|ml|l|lt|lata|sache|garrafa|bandeja|fardo|fresco|fresca|congelado|congelada)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function offerIdentityKey(offer: VisionOffer) {
  const quantity = Number(offer.package_quantity);
  const quantityKey = Number.isFinite(quantity) && quantity > 0 ? String(quantity) : "";
  return [
    normalizeOfferNameForDedupe(offer.product_name || ""),
    quantityKey,
    normalizeIdentity(offer.package_unit || ""),
  ].join("|");
}

function identityDice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const grams = (value: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i += 1) {
      const gram = value.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };

  const left = grams(a);
  const right = grams(b);
  let intersection = 0;
  for (const [gram, count] of left) {
    intersection += Math.min(count, right.get(gram) ?? 0);
  }

  const leftTotal = [...left.values()].reduce((sum, value) => sum + value, 0);
  const rightTotal = [...right.values()].reduce((sum, value) => sum + value, 0);
  return (2 * intersection) / Math.max(1, leftTotal + rightTotal);
}

function sameVisionIdentity(a: VisionOffer, b: VisionOffer) {
  if (offerIdentityKey(a) === offerIdentityKey(b)) return true;

  const aq = Number(a.package_quantity);
  const bq = Number(b.package_quantity);
  if (
    Number.isFinite(aq) && aq > 0 &&
    Number.isFinite(bq) && bq > 0 &&
    Math.abs(aq - bq) > 0.001
  ) return false;

  const au = normalizeIdentity(a.package_unit || "");
  const bu = normalizeIdentity(b.package_unit || "");
  if (au && bu && au !== bu) return false;

  const ab = normalizeOfferNameForDedupe(a.brand || "");
  const bb = normalizeOfferNameForDedupe(b.brand || "");
  if (
    ab && bb && ab !== bb &&
    !ab.includes(bb) && !bb.includes(ab) &&
    identityDice(ab, bb) < 0.9
  ) return false;

  const left = normalizeOfferNameForDedupe(a.product_name || "");
  const right = normalizeOfferNameForDedupe(b.product_name || "");
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;

  return identityDice(left, right) >= 0.86;
}

function positiveMoney(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sameMoney(a: unknown, b: unknown) {
  const left = positiveMoney(a);
  const right = positiveMoney(b);
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.005;
}

function mergeableVisionDuplicate(a: VisionOffer, b: VisionOffer) {
  if (!sameVisionIdentity(a, b)) return false;

  const aPrice = positiveMoney(a.price);
  const bPrice = positiveMoney(b.price);
  const aClub = positiveMoney(a.club_price);
  const bClub = positiveMoney(b.club_price);
  if (aPrice === null || bPrice === null) return false;

  if (sameMoney(aPrice, bPrice)) {
    if (aClub !== null && bClub !== null && !sameMoney(aClub, bClub)) return false;
    return true;
  }

  if (aClub !== null && sameMoney(aClub, bPrice)) return true;
  if (bClub !== null && sameMoney(bClub, aPrice)) return true;
  return false;
}

function unionOfferStrings(a: string[] | undefined, b: string[] | undefined) {
  const map = new Map<string, string>();
  for (const item of [...(a ?? []), ...(b ?? [])]) {
    const value = String(item ?? "").trim();
    const key = normalizeIdentity(value);
    if (key && !map.has(key)) map.set(key, value);
  }
  return [...map.values()];
}

function visionRichness(offer: VisionOffer) {
  let score = 0;
  if (positiveMoney(offer.club_price) !== null) score += 12;
  if (offer.brand) score += 3;
  if (positiveMoney(offer.package_quantity) !== null && offer.package_unit) score += 3;
  if (offer.purchase_limit) score += 3;
  score += (offer.included_types ?? []).length;
  score += (offer.excluded_types ?? []).length * 2;
  score += (offer.store_restrictions ?? []).length * 2;
  score += (offer.notes ?? []).length * 2;
  score += Math.max(0, Math.min(1, Number(offer.confidence) || 0));
  return score;
}

function mergeVisionDuplicate(a: VisionOffer, b: VisionOffer): VisionOffer {
  const scoreA = visionRichness(a);
  const scoreB = visionRichness(b);
  const pageA = Math.max(1, Math.trunc(Number(a.source_page) || 1));
  const pageB = Math.max(1, Math.trunc(Number(b.source_page) || 1));
  const preferred =
    scoreB > scoreA || (scoreA === scoreB && pageB >= pageA)
      ? b
      : a;
  const other = preferred === a ? b : a;

  return {
    ...other,
    ...preferred,
    brand: preferred.brand || other.brand || null,
    package_quantity: preferred.package_quantity ?? other.package_quantity ?? null,
    package_unit: preferred.package_unit || other.package_unit || null,
    club_price: positiveMoney(preferred.club_price) ?? positiveMoney(other.club_price),
    included_types: unionOfferStrings(preferred.included_types, other.included_types),
    excluded_types: unionOfferStrings(preferred.excluded_types, other.excluded_types),
    store_restrictions: unionOfferStrings(preferred.store_restrictions, other.store_restrictions),
    purchase_limit: preferred.purchase_limit || other.purchase_limit || null,
    notes: unionOfferStrings(preferred.notes, other.notes),
    confidence: Math.max(Number(preferred.confidence) || 0, Number(other.confidence) || 0),
  };
}

function dedupeVisionOffers(offers: VisionOffer[]) {
  const deduped: VisionOffer[] = [];
  for (const offer of offers) {
    const index = deduped.findIndex((existing) => mergeableVisionDuplicate(existing, offer));
    if (index < 0) {
      deduped.push(offer);
    } else {
      deduped[index] = mergeVisionDuplicate(deduped[index], offer);
    }
  }
  return deduped.sort((a, b) => Number(a.source_page || 1) - Number(b.source_page || 1));
}

function toCandidate(offer: VisionOffer, sourcePageOverride?: number): RichCandidate | null {
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
    brand: offer.brand?.trim() || null,
    price,
    packageInfo: pkg,
    normalizedPrice: normalized.normalizedPrice,
    baseUnit: normalized.baseUnit as BaseUnit,
    clubPrice: Number(offer.club_price) > 0,
    sourcePage: sourcePageOverride ?? Math.max(1, Math.trunc(Number(offer.source_page) || 1)),
    clubAdvertisedPrice: Number(offer.club_price) > 0 ? Number(offer.club_price) : null,
    includedTypes: offer.included_types ?? [],
    excludedTypes: offer.excluded_types ?? [],
    storeRestrictions: offer.store_restrictions ?? [],
    purchaseLimit: offer.purchase_limit ?? null,
    offerNotes: offer.notes ?? [],
    extractionConfidence: confidence,
    priceBasisQuantity: Number(offer.price_basis_quantity) || 1,
    priceBasisUnit: offer.price_basis_unit || "un",
    imageBox:
      offer.image_box &&
      Number(offer.image_box.width) > 0 &&
      Number(offer.image_box.height) > 0
        ? (() => {
            const x = Math.max(0, Math.min(999, Number(offer.image_box.x) || 0));
            const y = Math.max(0, Math.min(999, Number(offer.image_box.y) || 0));
            return {
              x,
              y,
              width: Math.max(
                1,
                Math.min(1000 - x, Number(offer.image_box.width) || 0),
              ),
              height: Math.max(
                1,
                Math.min(1000 - y, Number(offer.image_box.height) || 0),
              ),
            };
          })()
        : null,
    imageBoxConfidence: Math.max(
      0,
      Math.min(1, Number(offer.image_box_confidence) || 0),
    ),
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

async function invokeVision(
  file: File,
  pageNo: number,
  totalPages: number,
  preferredModel?: string,
  knownPageCount?: number,
) {
  const form = new FormData();
  form.append("file", file, file.name || `tabloide-pagina-${pageNo}`);
  if (preferredModel) form.append("preferred_model", preferredModel);
  if (knownPageCount && knownPageCount > 0) {
    form.append("known_page_count", String(knownPageCount));
  }

  const { data, error } = await supabase.functions.invoke<VisionResponse>("analyze-flyer", { body: form });
  if (error) {
    const details = await visionErrorDetails(error);
    throw new Error(`Página ${pageNo}/${totalPages}: ${details}`);
  }
  if (!data?.ok) {
    throw new Error(
      `Página ${pageNo}/${totalPages}: ${data?.message || data?.error || "resposta inválida do servidor"}`,
    );
  }
  if (!Array.isArray(data.offers)) {
    throw new Error(`Página ${pageNo}/${totalPages}: o servidor não retornou a lista de ofertas.`);
  }

  return data;
}

async function canvasToJpeg(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.95),
  );
  if (!blob) throw new Error("Não foi possível preparar a página para análise visual.");
  return new File([blob], name, { type: "image/jpeg" });
}

async function analyzeSingleImage(file: File, onProgress: Progress) {
  onProgress(1, 1, "Analisando visualmente o tabloide com IA…");
  const data = await invokeVision(file, 1, 1);
  const candidates = dedupeVisionOffers(data.offers ?? [])
    .map((offer) => toCandidate(offer, 1))
    .filter((item): item is RichCandidate => !!item);

  if (!candidates.length) {
    throw new Error("A análise visual terminou, mas não retornou nenhuma oferta confiável.");
  }

  const metaText = [
    data.retailer ?? "",
    data.valid_from && data.valid_to ? `${data.valid_from} a ${data.valid_to}` : "",
  ].filter(Boolean).join("\n");

  onProgress(1, 1, `${candidates.length} ofertas lidas por IA`);
  return {
    textByPage: [candidates.map((item) => `${item.rawName} ${item.price.toFixed(2)}`).join("\n")],
    metaText,
    pageCount: 1,
    candidates,
    retailer: data.retailer ?? null,
    validFrom: data.valid_from ?? null,
    validTo: data.valid_to ?? null,
    engine: data.engine ?? "gemini-vision",
    model: data.model,
  };
}

function isQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /429|RESOURCE_EXHAUSTED|VISION_RATE_LIMITED|quota/i.test(message);
}

async function pdfPageCount(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  return pdf.numPages;
}

export async function countFlyerPages(file: File) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return pdfPageCount(file);
  }
  return 1;
}

export function visionResponseToFlyerResult(data: VisionResponse, fallbackPageCount = 1) {
  const totalPages = Math.max(
    1,
    Math.trunc(Number(data.page_count) || fallbackPageCount || 1),
  );
  const candidates = dedupeVisionOffers(data.offers ?? [])
    .map((offer) => toCandidate(offer))
    .filter((item): item is RichCandidate => !!item)
    .filter((item) => item.sourcePage >= 1 && item.sourcePage <= totalPages);

  if (!candidates.length) {
    throw new Error("A análise terminou, mas não retornou nenhuma oferta confiável.");
  }

  const textByPage = Array.from({ length: totalPages }, (_, index) =>
    candidates
      .filter((item) => item.sourcePage === index + 1)
      .map((item) => `${item.rawName} ${item.price.toFixed(2)}`)
      .join("\n"),
  );

  const metaText = [
    data.retailer ?? "",
    data.valid_from && data.valid_to ? `${data.valid_from} a ${data.valid_to}` : "",
  ].filter(Boolean).join("\n");

  return {
    textByPage,
    metaText,
    pageCount: totalPages,
    candidates,
    retailer: data.retailer ?? null,
    validFrom: data.valid_from ?? null,
    validTo: data.valid_to ?? null,
    engine: data.engine ?? "gemini-vision",
    model: data.model,
  };
}

async function analyzePdfFast(file: File, onProgress: Progress) {
  // Only count pages locally. The expensive extraction/refinement now stays on the
  // server so mobile browsers may safely suspend the tab after the request starts.
  onProgress(1, 1, "Preparando PDF para análise no servidor…");
  const totalPages = await pdfPageCount(file);
  onProgress(1, totalPages, "Analisando todas as páginas no servidor…");
  const data = await invokeVision(file, 1, totalPages, undefined, totalPages);
  const candidates = dedupeVisionOffers(data.offers ?? [])
    .map((offer) => toCandidate(offer))
    .filter((item): item is RichCandidate => !!item)
    .filter((item) => item.sourcePage >= 1 && item.sourcePage <= totalPages);

  if (!candidates.length) {
    throw new Error("A leitura rápida não retornou ofertas confiáveis.");
  }

  const coveredPages = new Set(candidates.map((item) => item.sourcePage));
  const serverRefinedPages = new Set(data.refined_pages ?? []);
  const reviewedPages = new Set([...coveredPages, ...serverRefinedPages]);

  const textByPage = Array.from({ length: totalPages }, (_, index) =>
    candidates
      .filter((item) => item.sourcePage === index + 1)
      .map((item) => `${item.rawName} ${item.price.toFixed(2)}`)
      .join("\n"),
  );

  const metaText = [
    data.retailer ?? "",
    data.valid_from && data.valid_to ? `${data.valid_from} a ${data.valid_to}` : "",
  ].filter(Boolean).join("\n");

  onProgress(
    totalPages,
    totalPages,
    `${candidates.length} ofertas analisadas no servidor · ${reviewedPages.size}/${totalPages} página(s) com ofertas/refinamento`,
  );

  return {
    textByPage,
    metaText,
    pageCount: totalPages,
    candidates,
    retailer: data.retailer ?? null,
    validFrom: data.valid_from ?? null,
    validTo: data.valid_to ?? null,
    engine: data.engine ?? "gemini-vision",
    model: data.model,
  };
}

async function analyzePdfByPage(
  file: File,
  onProgress: Progress,
  pageNumbers?: number[],
  seed?: {
    candidates: RichCandidate[];
    retailer: string | null;
    validFrom: string | null;
    validTo: string | null;
    model?: string;
  },
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const totalPages = pdf.numPages;
  const targetPages = pageNumbers?.length
    ? [...new Set(pageNumbers)]
        .filter((pageNo) => Number.isInteger(pageNo) && pageNo >= 1 && pageNo <= totalPages)
        .sort((a, b) => a - b)
    : Array.from({ length: totalPages }, (_, index) => index + 1);

  const all: RichCandidate[] = [...(seed?.candidates ?? [])];
  const textByPage: string[] = Array.from({ length: totalPages }, (_, index) =>
    all
      .filter((item) => item.sourcePage === index + 1)
      .map((item) => `${item.rawName} ${item.price.toFixed(2)}`)
      .join("\n"),
  );
  let retailer: string | null = seed?.retailer ?? null;
  let validFrom: string | null = seed?.validFrom ?? null;
  let validTo: string | null = seed?.validTo ?? null;
  let model: string | undefined = seed?.model;

  for (let targetIndex = 0; targetIndex < targetPages.length; targetIndex++) {
    const pageNo = targetPages[targetIndex];

    if (targetIndex > 0) {
      onProgress(
        targetIndex + 1,
        targetPages.length,
        `Aguardando cota gratuita antes da página ${pageNo}/${totalPages}…`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2200));
    }

    onProgress(
      targetIndex + 1,
      targetPages.length,
      pageNumbers?.length
        ? `Refinando página ${pageNo}/${totalPages}…`
        : `Preparando página ${pageNo}/${totalPages}…`,
    );

    const page = await pdf.getPage(pageNo);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = Math.min(2800, Math.max(2100, baseViewport.width * 3.8));
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`Não foi possível preparar a página ${pageNo}.`);

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport } as any).promise;

    const pageFile = await canvasToJpeg(
      canvas,
      `${file.name.replace(/\.pdf$/i, "") || "tabloide"}-pagina-${pageNo}.jpg`,
    );
    canvas.width = 1;
    canvas.height = 1;

    onProgress(
      targetIndex + 1,
      targetPages.length,
      `Lendo página ${pageNo}/${totalPages} com IA…`,
    );

    let data: VisionResponse;
    try {
      data = await invokeVision(pageFile, pageNo, totalPages, model);
    } catch (firstError) {
      // One automatic retry avoids making the user repeat the whole import for a transient API failure.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      data = await invokeVision(pageFile, pageNo, totalPages, model).catch(() => {
        throw firstError;
      });
    }

    retailer ||= data.retailer ?? null;
    validFrom ||= data.valid_from ?? null;
    validTo ||= data.valid_to ?? null;
    if (data.model) model = data.model;

    const pageCandidates = (data.offers ?? [])
      .map((offer) => toCandidate(offer, pageNo))
      .filter((item): item is RichCandidate => !!item);

    // Replace only this page's fast-path results, keeping all other already-valid pages.
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].sourcePage === pageNo) all.splice(i, 1);
    }
    all.push(...pageCandidates);
    textByPage[pageNo - 1] = pageCandidates
      .map((item) => `${item.rawName} ${item.price.toFixed(2)}`)
      .join("\n");

    onProgress(
      targetIndex + 1,
      targetPages.length,
      `Página ${pageNo}/${totalPages}: ${pageCandidates.length} ofertas encontradas`,
    );
  }

  if (!all.length) {
    throw new Error("A análise visual terminou, mas não retornou nenhuma oferta confiável.");
  }

  const metaText = [
    retailer ?? "",
    validFrom && validTo ? `${validFrom} a ${validTo}` : "",
  ].filter(Boolean).join("\n");

  return {
    textByPage,
    metaText,
    pageCount: totalPages,
    candidates: all.sort((a, b) => a.sourcePage - b.sourcePage),
    retailer,
    validFrom,
    validTo,
    engine: "gemini-vision",
    model,
  };
}

export async function readFlyerFileSmart(file: File, onProgress: Progress) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    // PDF analysis/refinement stays in one server request. Do not fall back to the old
    // browser page-by-page flow: Android/iOS may suspend canvas, timers and JavaScript
    // as soon as the user changes app or tab.
    return analyzePdfFast(file, onProgress);
  }
  return analyzeSingleImage(file, onProgress);
}

// Explicit fallback kept only for future/manual recovery flows.
export async function readFlyerFileLocal(file: File, onProgress: Progress) {
  return readFlyerLocal(file, onProgress);
}
