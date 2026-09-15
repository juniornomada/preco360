import {
  inferPackage,
  normalizeSearchText,
  normalizedUnitPrice,
  type FlyerCandidate,
} from "@/lib/flyerAnalysis";

type Progress = (page: number, total: number, label: string) => void;
type SmartFlyerRead = {
  textByPage: string[];
  metaText: string;
  pageCount: number;
  candidates: FlyerCandidate[];
};
type BBox = { x0: number; y0: number; x1: number; y1: number };
type SpatialLine = { text: string; confidence: number; bbox: BBox };

const PRICE_RE = /(?:R\$\s*)?(\d{1,3}(?:[.\s]\d{3})*)\s*[,.:]\s*(\d{2})\b/g;

function cleanLine(value: string) {
  return value
    .replace(/[|•●]+/g, " ")
    .replace(/[<>»«]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value: string) {
  return cleanLine(value)
    .replace(/R\$/gi, " ")
    .replace(/^[+\-–—:;,.\s]+|[+\-–—:;,.\s]+$/g, "")
    .trim();
}

function isMarketing(value: string) {
  const text = normalizeSearchText(value);
  return !text
    || /^(ofertas?|validas?|grandes|aniversario|confira|lojas?|precos?|economize|beneficios?|exclusivos?|clube|vantagens?|cliente|selecao|mega)\b/.test(text)
    || /\b(www|com br|cnpj|proibida a venda|menores de 18|beba com moderacao)\b/.test(text);
}

function plausibleName(value: string) {
  const raw = cleanName(value);
  const text = normalizeSearchText(raw);
  if (text.length < 4 || text.length > 100 || isMarketing(text)) return false;
  const letters = (text.match(/[a-z]/g) ?? []).length;
  if (letters < 4 || !/[aeiou]/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  const oneChar = words.filter((word) => word.length === 1 && !/^\d$/.test(word)).length;
  if (oneChar >= 3) return false;
  const odd = (raw.match(/[^A-Za-zÀ-ÿ0-9 %/().,+&-]/g) ?? []).length;
  if (odd > Math.max(2, raw.length * 0.08)) return false;
  return true;
}

function parsePriceParts(integerPart: string, cents: string) {
  const integer = integerPart.replace(/[.\s]/g, "");
  return Number(`${integer}.${cents}`);
}

function pricesIn(value: string) {
  const result = [...value.matchAll(PRICE_RE)].map((match) => parsePriceParts(match[1], match[2]));
  if (result.length) return result.filter(Number.isFinite);
  const compact = value.trim().match(/^(?:R\$\s*)?(\d{1,3})\s+(\d{2})$/i);
  return compact ? [parsePriceParts(compact[1], compact[2])] : [];
}

function loosePrice(value: string) {
  const direct = pricesIn(value)[0];
  if (direct && Number.isFinite(direct)) return direct;
  const onlyDigits = value.replace(/[Oo]/g, "0").replace(/[^0-9]/g, "");
  if (onlyDigits.length >= 3 && onlyDigits.length <= 5) {
    const amount = Number(`${onlyDigits.slice(0, -2)}.${onlyDigits.slice(-2)}`);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function flattenLines(blocks: any[] | null | undefined) {
  const lines: SpatialLine[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = cleanLine(line.text ?? "");
        const bbox = line.bbox;
        if (!text || !bbox) continue;
        lines.push({ text, confidence: Number(line.confidence ?? 0), bbox });
      }
    }
  }
  return lines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

function median(values: number[], fallback: number) {
  if (!values.length) return fallback;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}

function height(line: SpatialLine) {
  return Math.max(1, line.bbox.y1 - line.bbox.y0);
}

function centerX(line: SpatialLine) {
  return (line.bbox.x0 + line.bbox.x1) / 2;
}

function centerY(line: SpatialLine) {
  return (line.bbox.y0 + line.bbox.y1) / 2;
}

function priceLike(line: SpatialLine, typicalHeight: number) {
  const text = line.text.replace(/R\$/gi, "").trim();
  const letters = (normalizeSearchText(text).match(/[a-z]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  if (letters > 1 || digits < 2) return false;
  if (pricesIn(text).length) return true;
  return height(line) >= typicalHeight * 1.35 && digits <= 6;
}

function crop(source: HTMLCanvasElement, bbox: BBox) {
  const x0 = Math.max(0, Math.floor(bbox.x0));
  const y0 = Math.max(0, Math.floor(bbox.y0));
  const x1 = Math.min(source.width, Math.ceil(bbox.x1));
  const y1 = Math.min(source.height, Math.ceil(bbox.y1));
  const out = document.createElement("canvas");
  out.width = Math.max(1, x1 - x0);
  out.height = Math.max(1, y1 - y0);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Não foi possível preparar uma região do tabloide.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function upscale(source: HTMLCanvasElement, factor = 1.45) {
  const out = document.createElement("canvas");
  out.width = Math.round(source.width * factor);
  out.height = Math.round(source.height * factor);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function nearestCardWidth(priceLines: SpatialLine[], anchor: SpatialLine, pageWidth: number) {
  const yTolerance = Math.max(height(anchor) * 2.8, 90);
  const distances = priceLines
    .filter((line) => line !== anchor && Math.abs(centerY(line) - centerY(anchor)) <= yTolerance)
    .map((line) => Math.abs(centerX(line) - centerX(anchor)))
    .filter((distance) => distance > pageWidth * 0.08)
    .sort((a, b) => a - b);
  const nearest = distances[0] ?? pageWidth / 4;
  return Math.max(pageWidth * 0.18, Math.min(pageWidth * 0.3, nearest * 0.92));
}

function spatialName(lines: SpatialLine[], anchor: SpatialLine, typicalHeight: number, cardWidth: number) {
  const cx = centerX(anchor);
  const candidates = lines
    .filter((line) => line !== anchor)
    .filter((line) => line.bbox.y1 <= anchor.bbox.y0 + typicalHeight * 0.35)
    .filter((line) => anchor.bbox.y0 - line.bbox.y1 <= Math.max(typicalHeight * 7, height(anchor) * 2.5))
    .filter((line) => Math.abs(centerX(line) - cx) <= cardWidth * 0.46)
    .filter((line) => !priceLike(line, typicalHeight) && plausibleName(line.text))
    .sort((a, b) => b.bbox.y1 - a.bbox.y1);

  if (!candidates.length) return { name: "", confidence: 0 };
  const selected = [candidates[0]];
  for (let i = 1; i < Math.min(3, candidates.length); i++) {
    const prev = selected[selected.length - 1];
    const next = candidates[i];
    if (prev.bbox.y0 - next.bbox.y1 > typicalHeight * 1.7) break;
    selected.push(next);
  }
  const name = cleanName(selected.reverse().map((line) => line.text).join(" "));
  const confidence = selected.reduce((sum, line) => sum + line.confidence, 0) / selected.length;
  return { name, confidence };
}

function nameFromLocalText(text: string) {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  if (!lines.length) return "";
  let priceIndex = lines.findIndex((line) => pricesIn(line).length > 0 || (/^\D*\d[\d\s,.]*$/.test(line) && loosePrice(line)));
  if (priceIndex < 0) priceIndex = lines.length;
  const before = lines.slice(Math.max(0, priceIndex - 4), priceIndex)
    .filter((line) => plausibleName(line))
    .filter((line) => !pricesIn(line).length)
    .filter((line) => (line.match(/\d/g) ?? []).length < Math.max(4, line.length * 0.45));
  const picked = before.slice(-3);
  return cleanName(picked.join(" "));
}

function tokenOverlap(a: string, b: string) {
  const A = new Set(normalizeSearchText(a).split(/\s+/).filter((w) => w.length >= 3));
  const B = new Set(normalizeSearchText(b).split(/\s+/).filter((w) => w.length >= 3));
  if (!A.size || !B.size) return 0;
  const hit = [...A].filter((word) => B.has(word)).length;
  return hit / Math.min(A.size, B.size);
}

async function rereadPrice(worker: any, canvas: HTMLCanvasElement, line: SpatialLine) {
  const h = height(line);
  const region = crop(canvas, {
    x0: line.bbox.x0 - Math.max(45, h * 1.5),
    y0: line.bbox.y0 - Math.max(16, h * 0.35),
    x1: line.bbox.x1 + Math.max(45, h * 1.5),
    y1: line.bbox.y1 + Math.max(16, h * 0.35),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: "0123456789,.",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(upscale(region, 1.7));
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "11" });
  return loosePrice(result.data?.text ?? "");
}

async function rereadCard(worker: any, canvas: HTMLCanvasElement, anchor: SpatialLine, typicalHeight: number, cardWidth: number) {
  const cx = centerX(anchor);
  const lookback = Math.max(typicalHeight * 8, height(anchor) * 3.1, 150);
  const region = crop(canvas, {
    x0: cx - cardWidth * 0.48,
    x1: cx + cardWidth * 0.48,
    y0: anchor.bbox.y0 - lookback,
    y1: anchor.bbox.y1 + Math.max(typicalHeight * 1.4, 35),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: "6",
    tessedit_char_whitelist: "",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(upscale(region));
  await worker.setParameters({ tessedit_pageseg_mode: "11" });
  const text = result.data?.text ?? "";
  return {
    text,
    confidence: Number(result.data?.confidence ?? 0),
    name: nameFromLocalText(text),
    price: pricesIn(text).find((value) => value > 0.2 && value < 500) ?? null,
  };
}

function validUnitPrice(candidate: FlyerCandidate) {
  if (!Number.isFinite(candidate.price) || candidate.price < 0.2 || candidate.price > 500) return false;
  const pkg = candidate.packageInfo;
  if (!pkg) return true;
  const one = pkg.baseQuantity >= 0.95 && pkg.baseQuantity <= 1.05;
  if (one && pkg.baseUnit === "kg" && candidate.price < 1.5) return false;
  if (one && pkg.baseUnit === "l" && candidate.price < 0.8) return false;
  if (candidate.normalizedPrice > 1500) return false;
  return true;
}

function dedupe(items: FlyerCandidate[]) {
  const result: FlyerCandidate[] = [];
  for (const item of items) {
    if (!plausibleName(item.rawName) || !validUnitPrice(item)) continue;
    const keyName = normalizeSearchText(item.rawName);
    const existing = result.findIndex((other) => {
      const overlap = tokenOverlap(other.rawName, item.rawName);
      return overlap >= 0.8 && Math.abs(other.price - item.price) <= 0.03;
    });
    if (existing >= 0) {
      if (keyName.length > normalizeSearchText(result[existing].rawName).length) result[existing] = item;
    } else result.push(item);
  }
  return result;
}

async function recognizeSpatial(worker: any, canvas: HTMLCanvasElement) {
  await worker.setParameters({
    tessedit_pageseg_mode: "11",
    tessedit_char_whitelist: "",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return { text: result.data?.text ?? "", blocks: result.data?.blocks ?? [] };
}

async function analyzeCanvas(worker: any, canvas: HTMLCanvasElement, page: number, total: number, onProgress: Progress) {
  onProgress(page, total, `Página ${page}/${total} · localizando cards de oferta`);
  const full = await recognizeSpatial(worker, canvas);
  const lines = flattenLines(full.blocks);
  const typicalHeight = median(lines.map(height).filter((h) => h >= 7 && h < 100), 24);
  const anchors = lines.filter((line) => priceLike(line, typicalHeight));
  const candidates: FlyerCandidate[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const cardWidth = nearestCardWidth(anchors, anchor, canvas.width);
    const spatial = spatialName(lines, anchor, typicalHeight, cardWidth);
    let price = loosePrice(anchor.text);

    const suspiciousPrice = !price || price < 1.5 || price > 250 || anchor.confidence < 60 || !/[,.]/.test(anchor.text);
    if (suspiciousPrice) {
      onProgress(page, total, `Página ${page}/${total} · conferindo preço ${i + 1}/${anchors.length}`);
      const reread = await rereadPrice(worker, canvas, anchor);
      if (reread) price = reread;
    }
    if (!price || price < 0.2 || price > 500) continue;

    let name = spatial.name;
    let localText = "";
    const suspiciousName = !plausibleName(name) || spatial.confidence < 78 || normalizeSearchText(name).split(/\s+/).length > 8;
    if (suspiciousName) {
      onProgress(page, total, `Página ${page}/${total} · lendo oferta ${i + 1}/${anchors.length}`);
      const local = await rereadCard(worker, canvas, anchor, typicalHeight, cardWidth);
      localText = local.text;
      if (plausibleName(local.name)) {
        const agreement = name ? tokenOverlap(name, local.name) : 1;
        if (!name || agreement >= 0.25 || local.confidence >= 68) name = local.name;
        else continue;
      } else if (!plausibleName(name) || spatial.confidence < 55) {
        continue;
      }
      if (suspiciousPrice && local.price && Math.abs(local.price - price) / Math.max(local.price, price) < 0.35) price = local.price;
    }

    if (!plausibleName(name)) continue;
    const nearby = lines
      .filter((line) => Math.abs(centerX(line) - centerX(anchor)) <= cardWidth * 0.5)
      .filter((line) => Math.abs(centerY(line) - centerY(anchor)) <= typicalHeight * 10)
      .map((line) => line.text)
      .join(" ");
    const context = `${name} ${localText} ${nearby}`;
    const packageInfo = inferPackage(name) ?? inferPackage(context);
    const normalized = normalizedUnitPrice(price, packageInfo);
    const candidate: FlyerCandidate = {
      rawName: cleanName(name),
      price,
      packageInfo,
      normalizedPrice: normalized.normalizedPrice,
      baseUnit: normalized.baseUnit,
      clubPrice: /clube\s*(de)?\s*vantagens?|pre[cç]o\s*clube/i.test(context),
      sourcePage: page,
    };
    if (validUnitPrice(candidate)) candidates.push(candidate);
  }

  return { text: full.text, metaText: full.text, candidates: dedupe(candidates) };
}

async function fileToCanvas(file: File) {
  const bitmap = await createImageBitmap(file);
  const targetWidth = Math.min(2800, Math.max(2000, bitmap.width));
  const scale = targetWidth / bitmap.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Não foi possível preparar a imagem.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export async function readFlyerFileSmart(file: File, onProgress: Progress): Promise<SmartFlyerRead> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("por");
  try {
    if (file.type.startsWith("image/")) {
      const canvas = await fileToCanvas(file);
      const analyzed = await analyzeCanvas(worker, canvas, 1, 1, onProgress);
      return { textByPage: [analyzed.text], metaText: analyzed.metaText, pageCount: 1, candidates: analyzed.candidates };
    }

    if (file.type !== "application/pdf") throw new Error("Envie um PDF ou uma imagem do tabloide.");
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const textByPage: string[] = [];
    const all: FlyerCandidate[] = [];
    let metaText = "";

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      onProgress(pageNumber, pdf.numPages, `Preparando página ${pageNumber}/${pdf.numPages}…`);
      const viewport = page.getViewport({ scale: 2.8 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Não foi possível preparar a página para leitura.");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport } as any).promise;

      const analyzed = await analyzeCanvas(worker, canvas, pageNumber, pdf.numPages, onProgress);
      textByPage.push(analyzed.text);
      all.push(...analyzed.candidates);
      if (pageNumber === 1) metaText = analyzed.metaText;
    }

    return {
      textByPage,
      metaText: metaText || textByPage[0] || "",
      pageCount: pdf.numPages,
      candidates: dedupe(all),
    };
  } finally {
    await worker.terminate();
  }
}
