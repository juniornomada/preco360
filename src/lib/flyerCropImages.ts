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

function cropToSquare(
  pageCanvas: HTMLCanvasElement,
  box: ReturnType<typeof validBox> extends infer T ? Exclude<T, null> : never,
) {
  const px = (box.x / 1000) * pageCanvas.width;
  const py = (box.y / 1000) * pageCanvas.height;
  const pw = (box.width / 1000) * pageCanvas.width;
  const ph = (box.height / 1000) * pageCanvas.height;

  // A small margin prevents packages from looking clipped while staying inside
  // the offer's visual cell.
  const padX = Math.min(pw * 0.07, pageCanvas.width * 0.018);
  const padY = Math.min(ph * 0.07, pageCanvas.height * 0.018);
  const sx = Math.max(0, px - padX);
  const sy = Math.max(0, py - padY);
  const sw = Math.min(pageCanvas.width - sx, pw + padX * 2);
  const sh = Math.min(pageCanvas.height - sy, ph + padY * 2);

  const size = 320;
  const margin = 16;
  const output = document.createElement("canvas");
  output.width = size;
  output.height = size;
  const ctx = output.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a miniatura.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const scale = Math.min((size - margin * 2) / sw, (size - margin * 2) / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(pageCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
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
      for (const { item, box } of byPage.get(pageNo) ?? []) {
        try {
          const crop = cropToSquare(pageCanvas, box);
          await persistCrop(crop, item, userId, flyerId, box.confidence);
          generated += 1;
          crop.width = 1;
          crop.height = 1;
        } catch (error) {
          console.warn("flyer crop failed", item.id, error);
        }
      }
      pageCanvas.width = 1;
      pageCanvas.height = 1;
    }

    await pdf.destroy();
  } else {
    const pageCanvas = await imageFileCanvas(file);
    for (const { item, box } of valid) {
      if (Math.max(1, Number(item.source_page) || 1) !== 1) continue;
      try {
        const crop = cropToSquare(pageCanvas, box);
        await persistCrop(crop, item, userId, flyerId, box.confidence);
        generated += 1;
        crop.width = 1;
        crop.height = 1;
      } catch (error) {
        console.warn("flyer crop failed", item.id, error);
      }
    }
    pageCanvas.width = 1;
    pageCanvas.height = 1;
  }

  return { generated, eligible: valid.length };
}
