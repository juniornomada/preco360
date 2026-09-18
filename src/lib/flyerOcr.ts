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
  let identity = offer.product_name.trim();
  const brand = offer.brand?.trim() ?? "";

  // Gemini sometimes separates the brand from product_name. The Radar name shown to
  // the user must preserve the complete commercial identity.
  if (
    brand &&
    !normalizeIdentity(identity).includes(normalizeIdentity(brand))
  ) {
    identity = `${identity} ${brand}`;
  }

  const pkg = displayPackage(offer);
  if (pkg && !normalizeIdentity(identity).includes(normalizeIdentity(pkg))) {
    identity = `${identity} ${pkg}`;
  }

  return identity.replace(/\s+/g, " ").trim();
}

function normalizeIdentity(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
) {
  const form = new FormData();
  form.append("file", file, file.name || `tabloide-pagina-${pageNo}`);
  if (preferredModel) form.append("preferred_model", preferredModel);

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
  const candidates = data.offers!
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

async function analyzePdfFast(file: File, onProgress: Progress) {
  // Count pages and start Gemini at the same time. The local PDF parse is useful for
  // completeness checks, but it should not delay the network request.
  const pageCountPromise = pdfPageCount(file);
  onProgress(1, 1, "Analisando o PDF em uma única leitura rápida…");
  const dataPromise = invokeVision(file, 1, 1);

  const [totalPages, data] = await Promise.all([pageCountPromise, dataPromise]);
  const candidates = (data.offers ?? [])
    .map((offer) => toCandidate(offer))
    .filter((item): item is RichCandidate => !!item)
    .filter((item) => item.sourcePage >= 1 && item.sourcePage <= totalPages);

  if (!candidates.length) {
    throw new Error("A leitura rápida não retornou ofertas confiáveis.");
  }

  const coveredPages = new Set(candidates.map((item) => item.sourcePage));
  const missingPages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((pageNo) => !coveredPages.has(pageNo));

  // Reuse the successful fast extraction and refine only pages that were not covered.
  // Previously one missed page caused the whole PDF to be re-read page by page.
  if (missingPages.length) {
    onProgress(
      1,
      missingPages.length,
      `Leitura rápida cobriu ${coveredPages.size}/${totalPages} páginas; refinando apenas ${missingPages.length} página(s)…`,
    );
    return analyzePdfByPage(file, onProgress, missingPages, {
      candidates,
      retailer: data.retailer ?? null,
      validFrom: data.valid_from ?? null,
      validTo: data.valid_to ?? null,
      model: data.model,
    });
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

  onProgress(
    totalPages,
    totalPages,
    `${candidates.length} ofertas encontradas em uma única análise`,
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
    // Fast path: send the original PDF once. Gemini can read multi-page PDFs directly,
    // so a five-page flyer normally needs a single API request instead of five.
    // If the response misses a page or comes back malformed, fall back automatically
    // to the slower page-by-page mode. Do NOT multiply requests when the free quota
    // itself is exhausted.
    try {
      return await analyzePdfFast(file, onProgress);
    } catch (error) {
      if (isQuotaError(error)) throw error;
      onProgress(1, 1, "Leitura rápida incompleta; refinando página por página…");
      return analyzePdfByPage(file, onProgress);
    }
  }
  return analyzeSingleImage(file, onProgress);
}

// Explicit fallback kept only for future/manual recovery flows.
export async function readFlyerFileLocal(file: File, onProgress: Progress) {
  return readFlyerLocal(file, onProgress);
}
