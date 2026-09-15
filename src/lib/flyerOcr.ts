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
    .replace(/\s+/g, " ")
    .trim();
}

function isMarketingLine(value: string) {
  const clean = normalizeSearchText(value);
  if (!clean) return true;
  return /^(ofertas?|validas?|grandes|aniversario|confira|lojas?|precos?|economize|beneficios?|exclusivos?|clube de vantagens|selecao aniversario|mega chute|cliente confianca)\b/.test(clean)
    || /\b(www|com br|cnpj|proibida a venda|menores de 18|beba com moderacao)\b/.test(clean);
}

function plausibleProductName(value: string) {
  const clean = normalizeSearchText(value);
  if (clean.length < 3 || clean.length > 120) return false;
  if (isMarketingLine(clean)) return false;
  const letters = (clean.match(/[a-z]/g) ?? []).length;
  if (letters < 4) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1 && clean.length < 4) return false;
  if (/^(unidades?|cada|leve|pague|tipos?|sabores?)\b/.test(clean) && words.length < 4) return false;
  return true;
}

function parsePrice(integerPart: string, cents: string) {
  const integer = integerPart.replace(/[.\s]/g, "");
  return Number(`${integer}.${cents}`);
}

function linePrices(line: string) {
  const matches = [...line.matchAll(PRICE_RE)].map((match) => ({
    index: match.index ?? 0,
    length: match[0].length,
    price: parsePrice(match[1], match[2]),
  }));

  if (!matches.length) {
    const compact = line.trim().match(/^(?:R\$\s*)?(\d{1,3})\s+(\d{2})$/i);
    if (compact) matches.push({ index: 0, length: line.length, price: parsePrice(compact[1], compact[2]) });
  }
  return matches;
}

function loosePrice(value: string) {
  const direct = linePrices(value)[0]?.price;
  if (direct && Number.isFinite(direct)) return direct;

  const clean = value.replace(/[Oo]/g, "0").replace(/[^0-9]/g, "");
  if (clean.length >= 3 && clean.length <= 5) {
    const amount = Number(`${clean.slice(0, -2)}.${clean.slice(-2)}`);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function plausibleUnitPrice(item: FlyerCandidate) {
  if (!Number.isFinite(item.price) || item.price < 0.2 || item.price > 500) return false;
  const pkg = item.packageInfo;
  if (!pkg) return true;
  const nearOneBaseUnit = pkg.baseQuantity >= 0.95 && pkg.baseQuantity <= 1.05;
  if (nearOneBaseUnit && pkg.baseUnit === "kg" && item.price < 1) return false;
  if (nearOneBaseUnit && pkg.baseUnit === "l" && item.price < 0.5) return false;
  return true;
}

function dedupeCandidates(items: FlyerCandidate[]) {
  const result: FlyerCandidate[] = [];
  for (const item of items) {
    if (!plausibleUnitPrice(item) || !plausibleProductName(item.rawName)) continue;

    const normalized = normalizeSearchText(item.rawName);
    const words = new Set(normalized.split(/\s+/).filter((word) => word.length >= 3));
    const duplicateIndex = result.findIndex((existing) => {
      const other = normalizeSearchText(existing.rawName);
      const otherWords = new Set(other.split(/\s+/).filter((word) => word.length >= 3));
      const intersection = [...words].filter((word) => otherWords.has(word)).length;
      const union = new Set([...words, ...otherWords]).size;
      const sameName = other === normalized || other.includes(normalized) || normalized.includes(other)
        || (union > 0 && intersection / union >= 0.72);
      if (!sameName) return false;
      return Math.abs(existing.price - item.price) < 0.03;
    });

    if (duplicateIndex >= 0) {
      if (item.rawName.length > result[duplicateIndex].rawName.length) result[duplicateIndex] = item;
      continue;
    }
    result.push(item);
  }
  return result;
}

function parseChunk(text: string, sourcePage: number): FlyerCandidate[] {
  const lines = text.split(/\r?\n/).map(cleanLine);
  const found: FlyerCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    for (const match of linePrices(line)) {
      const price = match.price;
      if (!Number.isFinite(price) || price < 0.2 || price > 500) continue;
      let rawName = cleanName(line.slice(0, match.index));
      if (!plausibleProductName(rawName)) {
        const previous = [lines[i - 2], lines[i - 1]].filter(Boolean).map(cleanName).filter(plausibleProductName);
        rawName = cleanName(previous.join(" "));
      }
      if (!plausibleProductName(rawName)) continue;
      const context = [lines[i - 2], lines[i - 1], line, lines[i + 1]].filter(Boolean).join(" ");
      const packageInfo = inferPackage(rawName) ?? inferPackage(context);
      const normalized = normalizedUnitPrice(price, packageInfo);
      found.push({
        rawName,
        price,
        packageInfo,
        normalizedPrice: normalized.normalizedPrice,
        baseUnit: normalized.baseUnit,
        clubPrice: /clube\s*(de)?\s*vantagens?|pre[cç]o\s*clube/i.test(context),
        sourcePage,
      });
    }
  }
  return dedupeCandidates(found);
}

function flattenLines(blocks: any[] | null | undefined): SpatialLine[] {
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

function median(values: number[]) {
  if (!values.length) return 24;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function lineHeight(line: SpatialLine) {
  return Math.max(1, line.bbox.y1 - line.bbox.y0);
}

function centerX(line: SpatialLine) {
  return (line.bbox.x0 + line.bbox.x1) / 2;
}

function looksLikePriceLine(line: SpatialLine, typicalHeight: number) {
  const text = line.text.replace(/R\$/gi, "").trim();
  const letters = (normalizeSearchText(text).match(/[a-z]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  if (!digits || letters > 1) return false;
  if (linePrices(text).length) return true;
  return digits >= 2 && lineHeight(line) >= typicalHeight * 1.35;
}

function cropRect(source: HTMLCanvasElement, bbox: BBox, padX: number, padY: number) {
  const x0 = Math.max(0, Math.floor(bbox.x0 - padX));
  const y0 = Math.max(0, Math.floor(bbox.y0 - padY));
  const x1 = Math.min(source.width, Math.ceil(bbox.x1 + padX));
  const y1 = Math.min(source.height, Math.ceil(bbox.y1 + padY));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, x1 - x0);
  canvas.height = Math.max(1, y1 - y0);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Não foi possível preparar uma região do tabloide.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function rereadPrice(worker: any, source: HTMLCanvasElement, line: SpatialLine) {
  const height = lineHeight(line);
  const crop = cropRect(source, line.bbox, Math.max(45, height * 1.3), Math.max(18, height * 0.45));
  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: "0123456789,.",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(crop);
  await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "11" });
  return loosePrice(result.data?.text ?? "");
}

function nameForPrice(lines: SpatialLine[], priceLine: SpatialLine, typicalHeight: number, pageWidth: number) {
  const maxCenterDistance = Math.max(pageWidth * 0.12, lineHeight(priceLine) * 2.5);
  const verticalLimit = Math.max(typicalHeight * 7.5, lineHeight(priceLine) * 2.5);
  const candidates = lines
    .filter((line) => {
      if (line === priceLine) return false;
      if (line.bbox.y1 > priceLine.bbox.y0 + typicalHeight * 0.45) return false;
      const gap = priceLine.bbox.y0 - line.bbox.y1;
      if (gap < 0 || gap > verticalLimit) return false;
      if (Math.abs(centerX(line) - centerX(priceLine)) > maxCenterDistance) return false;
      if (looksLikePriceLine(line, typicalHeight)) return false;
      return plausibleProductName(cleanName(line.text));
    })
    .sort((a, b) => b.bbox.y1 - a.bbox.y1);

  if (!candidates.length) return "";
  const chosen: SpatialLine[] = [candidates[0]];
  for (let i = 1; i < Math.min(3, candidates.length); i++) {
    const previous = chosen[chosen.length - 1];
    const current = candidates[i];
    const gap = previous.bbox.y0 - current.bbox.y1;
    if (gap > typicalHeight * 1.8) break;
    chosen.push(current);
  }
  return cleanName(chosen.reverse().map((line) => line.text).join(" "));
}

async function parseSpatial(
  worker: any,
  canvas: HTMLCanvasElement,
  blocks: any[] | null | undefined,
  sourcePage: number,
  onProgress: Progress,
  total: number,
) {
  const lines = flattenLines(blocks);
  if (!lines.length) return [] as FlyerCandidate[];
  const typicalHeight = median(lines.map(lineHeight).filter((height) => height >= 8));
  const priceLines = lines.filter((line) => looksLikePriceLine(line, typicalHeight));
  const found: FlyerCandidate[] = [];

  for (let index = 0; index < priceLines.length; index++) {
    const priceLine = priceLines[index];
    let price = loosePrice(priceLine.text);
    const suspicious = !price || price < 1.25 || price > 300 || priceLine.confidence < 55 || !/[,.]/.test(priceLine.text);
    if (suspicious) {
      onProgress(sourcePage, total, `Página ${sourcePage}/${total} · conferindo preço ${index + 1}/${priceLines.length}`);
      const reread = await rereadPrice(worker, canvas, priceLine);
      if (reread) price = reread;
    }
    if (!price || price < 0.2 || price > 500) continue;

    const rawName = nameForPrice(lines, priceLine, typicalHeight, canvas.width);
    if (!plausibleProductName(rawName)) continue;

    const nearby = lines
      .filter((line) => Math.abs(centerX(line) - centerX(priceLine)) < canvas.width * 0.13)
      .filter((line) => Math.abs(line.bbox.y0 - priceLine.bbox.y0) < typicalHeight * 9)
      .map((line) => line.text)
      .join(" ");
    const packageInfo = inferPackage(rawName) ?? inferPackage(nearby);
    const normalized = normalizedUnitPrice(price, packageInfo);
    const candidate: FlyerCandidate = {
      rawName,
      price,
      packageInfo,
      normalizedPrice: normalized.normalizedPrice,
      baseUnit: normalized.baseUnit,
      clubPrice: /clube\s*(de)?\s*vantagens?|pre[cç]o\s*clube/i.test(nearby),
      sourcePage,
    };
    if (plausibleUnitPrice(candidate)) found.push(candidate);
  }
  return dedupeCandidates(found);
}

async function fileToCanvas(file: File) {
  const bitmap = await createImageBitmap(file);
  const targetWidth = Math.min(2600, Math.max(1800, bitmap.width));
  const scale = targetWidth / bitmap.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Não foi possível preparar a imagem.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
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

async function fallbackColumns(worker: any, canvas: HTMLCanvasElement, page: number, total: number, onProgress: Progress) {
  const all: FlyerCandidate[] = [];
  const texts: string[] = [];
  const columns = 4;
  const width = canvas.width / columns;
  for (let col = 0; col < columns; col++) {
    const left = Math.max(0, Math.floor(col * width - 35));
    const right = Math.min(canvas.width, Math.ceil((col + 1) * width + 35));
    const crop = cropRect(canvas, { x0: left, y0: 0, x1: right, y1: canvas.height }, 0, 0);
    onProgress(page, total, `Página ${page}/${total} · leitura alternativa ${col + 1}/${columns}`);
    await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
    const result = await worker.recognize(crop);
    const text = result.data?.text ?? "";
    texts.push(text);
    all.push(...parseChunk(text, page));
  }
  return { text: texts.join("\n"), candidates: dedupeCandidates(all) };
}

async function analyzeCanvas(worker: any, canvas: HTMLCanvasElement, page: number, total: number, onProgress: Progress) {
  onProgress(page, total, `Página ${page}/${total} · lendo posições de produtos e preços`);
  const spatial = await recognizeSpatial(worker, canvas);
  const candidates = await parseSpatial(worker, canvas, spatial.blocks, page, onProgress, total);

  if (candidates.length >= 6) {
    return { text: spatial.text, metaText: spatial.text, candidates };
  }

  const fallback = await fallbackColumns(worker, canvas, page, total, onProgress);
  return {
    text: spatial.text || fallback.text,
    metaText: spatial.text || fallback.text,
    candidates: fallback.candidates.length > candidates.length ? fallback.candidates : candidates,
  };
}

export async function readFlyerFileSmart(file: File, onProgress: Progress): Promise<SmartFlyerRead> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("por");

  try {
    if (file.type.startsWith("image/")) {
      const canvas = await fileToCanvas(file);
      const analyzed = await analyzeCanvas(worker, canvas, 1, 1, onProgress);
      return {
        textByPage: [analyzed.text],
        metaText: analyzed.metaText,
        pageCount: 1,
        candidates: analyzed.candidates,
      };
    }

    if (file.type !== "application/pdf") throw new Error("Envie um PDF ou uma imagem do tabloide.");

    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const textByPage: string[] = [];
    const allCandidates: FlyerCandidate[] = [];
    let metaText = "";

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      onProgress(pageNumber, pdf.numPages, `Preparando página ${pageNumber}/${pdf.numPages}…`);
      const viewport = page.getViewport({ scale: 2.6 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Não foi possível preparar a página para leitura.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport } as any).promise;

      const analyzed = await analyzeCanvas(worker, canvas, pageNumber, pdf.numPages, onProgress);
      textByPage.push(analyzed.text);
      allCandidates.push(...analyzed.candidates);
      if (pageNumber === 1) metaText = analyzed.metaText;
    }

    return {
      textByPage,
      metaText: metaText || textByPage[0] || "",
      pageCount: pdf.numPages,
      candidates: dedupeCandidates(allCandidates),
    };
  } finally {
    await worker.terminate();
  }
}
