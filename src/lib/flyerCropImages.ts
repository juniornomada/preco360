import { supabase } from "@/integrations/supabase/client";

export type StoredCropItem = {
  id: string;
  source_page: number | null;
  image_bbox: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  } | null;
  image_bbox_confidence: number | string | null;
};

type Progress = (current: number, total: number, label: string) => void;

function validBox(item: StoredCropItem) {
  const box = item.image_bbox;
  const confidence = Number(item.image_bbox_confidence) || 0;
  if (!box || confidence < 0.8) return null;

  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 8 || height <= 8) return null;
  if (x < 0 || y < 0 || x >= 1000 || y >= 1000) return null;
  if (x + width > 1015 || y + height > 1015) return null;

  return {
    x: Math.max(0, Math.min(1000, x)),
    y: Math.max(0, Math.min(1000, y)),
    width: Math.max(1, Math.min(1000 - x, width)),
    height: Math.max(1, Math.min(1000 - y, height)),
    confidence,
  };
}

async function canvasJpeg(canvas: HTMLCanvasElement, quality = 0.9) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Não foi possível gerar a miniatura do tabloide.");
  return blob;
}

type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Component = PixelRect & {
  pixels: number;
  redPixels: number;
};

function median(values: number[]) {
  if (!values.length) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function estimateBackground(image: ImageData) {
  const { data, width, height } = image;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 50));

  const sample = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] < 200) return;
    rs.push(data[idx]);
    gs.push(data[idx + 1]);
    bs.push(data[idx + 2]);
  };

  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    sample(0, y);
    sample(width - 1, y);
  }

  return { r: median(rs), g: median(gs), b: median(bs) };
}

function buildForegroundMask(image: ImageData) {
  const { data, width, height } = image;
  const background = estimateBackground(image);
  const mask = new Uint8Array(width * height);
  const red = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (a < 40) continue;

      const dr = r - background.r;
      const dg = g - background.g;
      const db = b - background.b;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max - min;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const backgroundLum =
        0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;

      const isForeground =
        distance > 34 ||
        Math.abs(luminance - backgroundLum) > 34 ||
        saturation > 48;

      if (!isForeground) continue;
      mask[y * width + x] = 1;

      if (r > 145 && r > g * 1.55 && r > b * 1.45) {
        red[y * width + x] = 1;
      }
    }
  }

  // One-pixel dilation joins nearby pieces of a package without turning text lines
  // into one giant block.
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let active = 0;
      for (let dy = -1; dy <= 1 && !active; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (mask[ny * width + nx]) {
            active = 1;
            break;
          }
        }
      }
      dilated[y * width + x] = active;
    }
  }

  return { mask: dilated, red };
}

function findComponents(mask: Uint8Array, red: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(mask.length);
  const components: Component[] = [];
  const queue = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let pixels = 0;
    let redPixels = 0;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels += 1;
      redPixels += red[current] ? 1 : 0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    components.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels,
      redPixels,
    });
  }

  return components;
}

function rectIntersectionRatio(a: PixelRect, b: PixelRect) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  return intersection / Math.max(1, a.width * a.height);
}

function pickProductComponent(
  components: Component[],
  width: number,
  height: number,
  target: PixelRect,
) {
  const canvasArea = width * height;
  let best: Component | null = null;
  let bestScore = -Infinity;

  for (const component of components) {
    const boxArea = component.width * component.height;
    const areaRatio = boxArea / canvasArea;
    const fillRatio = component.pixels / Math.max(1, boxArea);
    const aspect = component.width / Math.max(1, component.height);

    if (component.pixels < canvasArea * 0.0025) continue;
    if (component.width < width * 0.035 || component.height < height * 0.035) continue;
    if (aspect > 6.5 || aspect < 0.14) continue;

    const centerX = component.x + component.width / 2;
    const centerY = component.y + component.height / 2;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;
    const distance = Math.hypot(
      (centerX - targetCenterX) / Math.max(1, width),
      (centerY - targetCenterY) / Math.max(1, height),
    );
    const centrality = 1 - Math.min(1, distance * 1.8);
    const overlap = rectIntersectionRatio(component, target);
    const upperBias = 1 - Math.min(1, centerY / Math.max(1, height)) * 0.28;
    const redRatio = component.redPixels / Math.max(1, component.pixels);

    // Text usually forms thin, sparse horizontal components. Giant red price digits
    // often have lots of red pixels but relatively little filled area.
    const textPenalty =
      (aspect > 2.8 && component.height < height * 0.22 ? 0.42 : 0) +
      (fillRatio < 0.12 ? 0.22 : 0);
    const pricePenalty =
      redRatio > 0.48 && centerY > height * 0.42 && fillRatio < 0.5 ? 0.34 : 0;
    const edgePenalty =
      (component.x <= 1 ||
      component.y <= 1 ||
      component.x + component.width >= width - 1 ||
      component.y + component.height >= height - 1)
        ? 0.08
        : 0;

    const sizeScore = Math.min(1, areaRatio / 0.24);
    const densityScore = Math.min(1, fillRatio / 0.48);

    const score =
      sizeScore * 0.34 +
      densityScore * 0.16 +
      centrality * 0.18 +
      overlap * 0.24 +
      upperBias * 0.08 -
      textPenalty -
      pricePenalty -
      edgePenalty;

    if (score > bestScore) {
      bestScore = score;
      best = component;
    }
  }

  return bestScore >= 0.22 ? best : null;
}

function refineProductRect(
  pageCanvas: HTMLCanvasElement,
  rough: PixelRect,
): PixelRect | null {
  // Never leave the AI-localized cell. Earlier builds expanded around the box and
  // could jump into the neighboring offer. Refinement may only shrink INSIDE it.
  const region = {
    x: Math.max(0, rough.x),
    y: Math.max(0, rough.y),
    width: Math.min(pageCanvas.width - Math.max(0, rough.x), rough.width),
    height: Math.min(pageCanvas.height - Math.max(0, rough.y), rough.height),
  };

  if (region.width < 20 || region.height < 20) return null;

  const maxAnalysis = 300;
  const scale = Math.min(1, maxAnalysis / Math.max(region.width, region.height));
  const analysis = document.createElement("canvas");
  analysis.width = Math.max(40, Math.round(region.width * scale));
  analysis.height = Math.max(40, Math.round(region.height * scale));
  const ctx = analysis.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(
    pageCanvas,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    analysis.width,
    analysis.height,
  );

  const image = ctx.getImageData(0, 0, analysis.width, analysis.height);
  const { mask, red } = buildForegroundMask(image);
  const components = findComponents(mask, red, analysis.width, analysis.height);

  const target = {
    x: ((rough.x - region.x) / region.width) * analysis.width,
    y: ((rough.y - region.y) / region.height) * analysis.height,
    width: (rough.width / region.width) * analysis.width,
    height: (rough.height / region.height) * analysis.height,
  };

  const selected = pickProductComponent(
    components,
    analysis.width,
    analysis.height,
    target,
  );
  if (!selected) return null;

  const sx = region.x + (selected.x / analysis.width) * region.width;
  const sy = region.y + (selected.y / analysis.height) * region.height;
  const sw = (selected.width / analysis.width) * region.width;
  const sh = (selected.height / analysis.height) * region.height;

  // Final padding is deliberately small: enough to restore package edges without
  // pulling the neighboring product, text block or price back into the thumbnail.
  const padX = Math.max(4, Math.min(sw * 0.055, pageCanvas.width * 0.008));
  const padY = Math.max(4, Math.min(sh * 0.055, pageCanvas.height * 0.008));
  const x = Math.max(region.x, sx - padX);
  const y = Math.max(region.y, sy - padY);
  const right = Math.min(region.x + region.width, sx + sw + padX);
  const bottom = Math.min(region.y + region.height, sy + sh + padY);
  const refined = { x, y, width: right - x, height: bottom - y };

  const aspect = refined.width / Math.max(1, refined.height);
  const roughArea = rough.width * rough.height;
  const refinedArea = refined.width * refined.height;
  if (refined.width < 24 || refined.height < 24) return null;
  if (aspect > 5 || aspect < 0.2) return null;
  if (refinedArea < roughArea * 0.035) return null;

  return refined;
}

function cropToSquare(
  pageCanvas: HTMLCanvasElement,
  box: ReturnType<typeof validBox> extends infer T ? Exclude<T, null> : never,
) {
  const rough = {
    x: (box.x / 1000) * pageCanvas.width,
    y: (box.y / 1000) * pageCanvas.height,
    width: (box.width / 1000) * pageCanvas.width,
    height: (box.height / 1000) * pageCanvas.height,
  };

  // Refine only inside the dedicated AI box. If no trustworthy visual component
  // is found, keep the AI box itself instead of drifting into another offer.
  const source = refineProductRect(pageCanvas, rough) ?? rough;

  const size = 320;
  const margin = 18;
  const output = document.createElement("canvas");
  output.width = size;
  output.height = size;
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a miniatura.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const scale = Math.min(
    (size - margin * 2) / source.width,
    (size - margin * 2) / source.height,
  );
  const dw = source.width * scale;
  const dh = source.height * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    pageCanvas,
    source.x,
    source.y,
    source.width,
    source.height,
    dx,
    dy,
    dw,
    dh,
  );
  return output;
}

async function persistCrop(
  crop: HTMLCanvasElement,
  item: StoredCropItem,
  userId: string,
  flyerId: string,
  confidence: number,
) {
  const blob = await canvasJpeg(crop, 0.9);
  const path = `${userId}/offer-crops/${flyerId}/${item.id}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("flyers")
    .upload(path, blob, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("flyer_items")
    .update({
      image_storage_path: path,
      image_source: "flyer_crop",
      image_confidence: confidence,
      image_match_status: "verified",
    })
    .eq("id", item.id);
  if (updateError) throw updateError;
}

async function persistPageCrops(
  pageCanvas: HTMLCanvasElement,
  entries: Array<{
    item: StoredCropItem;
    box: Exclude<ReturnType<typeof validBox>, null>;
  }>,
  userId: string,
  flyerId: string,
) {
  let generated = 0;
  const concurrency = 6;

  for (let start = 0; start < entries.length; start += concurrency) {
    const batch = entries.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map(async ({ item, box }) => {
        let crop: HTMLCanvasElement | null = null;
        try {
          crop = cropToSquare(pageCanvas, box);
          await persistCrop(crop, item, userId, flyerId, box.confidence);
          return 1;
        } catch (error) {
          console.warn("flyer crop failed", item.id, error);
          return 0;
        } finally {
          if (crop) {
            crop.width = 1;
            crop.height = 1;
          }
        }
      }),
    );
    generated += results.reduce((sum, value) => sum + value, 0);
  }

  return generated;
}

async function renderPdfPage(pdf: any, pageNo: number) {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const targetWidth = Math.min(2200, Math.max(1600, base.width * 2.6));
  const viewport = page.getViewport({ scale: targetWidth / base.width });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`Não foi possível renderizar a página ${pageNo}.`);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport } as any).promise;
  return canvas;
}

async function imageFileCanvas(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a imagem do tabloide.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

export async function sourceFileFromStorage(
  path: string,
  fileName: string,
  mimeType?: string | null,
) {
  const { data, error } = await supabase.storage.from("flyers").download(path);
  if (error || !data) throw error ?? new Error("Arquivo original do tabloide não encontrado.");
  return new File([data], fileName || "tabloide.pdf", {
    type: mimeType || data.type || "application/pdf",
  });
}

export async function generateFlyerOfferCrops({
  file,
  userId,
  flyerId,
  items,
  onProgress,
}: {
  file: File;
  userId: string;
  flyerId: string;
  items: StoredCropItem[];
  onProgress?: Progress;
}) {
  const valid = items
    .map((item) => ({ item, box: validBox(item) }))
    .filter(
      (entry): entry is { item: StoredCropItem; box: Exclude<ReturnType<typeof validBox>, null> } =>
        !!entry.box,
    );

  if (!valid.length) return { generated: 0, eligible: 0 };

  const byPage = new Map<number, typeof valid>();
  for (const entry of valid) {
    const pageNo = Math.max(1, Math.trunc(Number(entry.item.source_page) || 1));
    const group = byPage.get(pageNo) ?? [];
    group.push(entry);
    byPage.set(pageNo, group);
  }

  let generated = 0;
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pageNo = pages[pageIndex];
      if (pageNo > pdf.numPages) continue;

      onProgress?.(
        pageIndex + 1,
        pages.length,
        `Criando imagens do tabloide · página ${pageNo}/${pdf.numPages}…`,
      );

      const pageCanvas = await renderPdfPage(pdf, pageNo);
      generated += await persistPageCrops(
        pageCanvas,
        byPage.get(pageNo) ?? [],
        userId,
        flyerId,
      );
      pageCanvas.width = 1;
      pageCanvas.height = 1;
    }

    await pdf.destroy();
  } else {
    const pageCanvas = await imageFileCanvas(file);
    generated += await persistPageCrops(
      pageCanvas,
      valid.filter(({ item }) => Math.max(1, Number(item.source_page) || 1) === 1),
      userId,
      flyerId,
    );
    pageCanvas.width = 1;
    pageCanvas.height = 1;
  }

  return { generated, eligible: valid.length };
}
