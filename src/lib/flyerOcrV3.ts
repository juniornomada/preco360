import {
  inferPackage,
  normalizeSearchText,
  normalizedUnitPrice,
  parseFlyerText,
  type FlyerCandidate,
} from "@/lib/flyerAnalysis";

type Progress = (page: number, total: number, label: string) => void;
type SmartFlyerRead = {
  textByPage: string[];
  metaText: string;
  pageCount: number;
  candidates: FlyerCandidate[];
};
type Grid = { xs: number[]; ys: number[] };
type Rect = { x0: number; y0: number; x1: number; y1: number };

const PRICE_RE = /(?:R\$\s*)?(\d{1,3})\s*[,.:]\s*(\d{2})\b/;
const STOP = new Set(["e", "de", "da", "do", "das", "dos", "ou", "com", "sem", "tipo", "tipos", "kg", "g", "ml", "l", "unidade", "unidades"]);

const WORD_FIXES: Record<string, string> = {
  logarto: "Lagarto",
  frocionada: "Fracionada",
  frocionado: "Fracionado",
  bondeja: "bandeja",
  perolo: "Pérola",
  perola: "Pérola",
  mportada: "importada",
  forinha: "Farinha",
};

function clean(value: string) {
  return value.replace(/[|•●<>»«]+/g, " ").replace(/\s+/g, " ")
    .replace(/^[\s:;,.—–-]+|[\s:;,.—–-]+$/g, "").trim();
}

function fixCommonOcr(value: string) {
  return clean(value).split(/\s+/).map((word) => {
    const key = normalizeSearchText(word);
    return WORD_FIXES[key] ?? word;
  }).join(" ");
}

function plausibleName(value: string) {
  const text = normalizeSearchText(value);
  if (text.length < 4 || text.length > 110) return false;
  if ((text.match(/[a-z]/g) ?? []).length < 4) return false;
  if (/^(ofertas?|validas?|grandes|aniversario|confira|lojas?|precos?|clube|vantagens?|cliente|selecao|mega)\b/.test(text)) return false;
  if (/\b(www|com br|cnpj|proibida|menores de 18|beba com moderacao)\b/.test(text)) return false;
  return true;
}

function contentWords(value: string) {
  return normalizeSearchText(value).split(/\s+/).filter((word) => word.length >= 3 && !STOP.has(word));
}

function nameScore(value: string) {
  const words = contentWords(value);
  let score = words.length * 2 + Math.min(value.length, 60) / 30;
  if (/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b/i.test(value)) score += 3;
  if (/\b(?:kg|unidade|tipos?)\b/i.test(value)) score += 1.5;
  return score;
}

function pickName(text: string) {
  const lines = text.split(/\r?\n/).map(clean).filter(plausibleName)
    .filter((line) => (line.match(/\d/g) ?? []).length < Math.max(5, line.length * 0.5));
  if (!lines.length) return "";
  const choices: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    choices.push(lines[i]);
    if (i + 1 < lines.length) choices.push(`${lines[i]} ${lines[i + 1]}`);
    if (i + 2 < lines.length) choices.push(`${lines[i]} ${lines[i + 1]} ${lines[i + 2]}`);
  }
  return fixCommonOcr(choices.sort((a, b) => nameScore(b) - nameScore(a))[0] ?? "");
}

function explicitPrices(text: string) {
  const found: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(PRICE_RE);
    if (match) {
      const value = Number(`${match[1]}.${match[2]}`);
      if (value >= 0.2 && value <= 500) found.push(value);
    }
  }
  return found;
}

function loosePrice(text: string) {
  const explicit = explicitPrices(text)[0];
  if (explicit) return explicit;
  const groups = text.match(/\d[\d\s,./]{1,8}/g) ?? [];
  for (const group of groups) {
    const pieces = group.split(/[\/|]/);
    for (const piece of pieces) {
      const digits = piece.replace(/\D/g, "");
      if (digits.length >= 3 && digits.length <= 5) {
        const value = Number(`${digits.slice(0, -2)}.${digits.slice(-2)}`);
        if (value >= 0.2 && value <= 500) return value;
      }
    }
  }
  return null;
}

function validCandidate(item: FlyerCandidate) {
  if (!plausibleName(item.rawName) || !Number.isFinite(item.price) || item.price < 0.2 || item.price > 500) return false;
  if (item.packageInfo?.baseQuantity && item.packageInfo.baseQuantity >= 0.95 && item.packageInfo.baseQuantity <= 1.05) {
    if (item.packageInfo.baseUnit === "kg" && item.price < 1.5) return false;
    if (item.packageInfo.baseUnit === "l" && item.price < 0.8) return false;
  }
  return item.normalizedPrice <= 1500;
}

function candidate(rawName: string, price: number, page: number, clubPrice = false): FlyerCandidate | null {
  const packageInfo = inferPackage(rawName);
  const normalized = normalizedUnitPrice(price, packageInfo);
  const item: FlyerCandidate = {
    rawName: fixCommonOcr(rawName), price, packageInfo,
    normalizedPrice: normalized.normalizedPrice, baseUnit: normalized.baseUnit,
    clubPrice, sourcePage: page,
  };
  return validCandidate(item) ? item : null;
}

function tokenOverlap(a: string, b: string) {
  const A = new Set(normalizeSearchText(a).split(/\s+/).filter((w) => w.length >= 3));
  const B = new Set(normalizeSearchText(b).split(/\s+/).filter((w) => w.length >= 3));
  if (!A.size || !B.size) return 0;
  return [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size);
}

function dedupe(items: FlyerCandidate[]) {
  const out: FlyerCandidate[] = [];
  for (const item of items) {
    if (!validCandidate(item)) continue;
    const idx = out.findIndex((other) => tokenOverlap(other.rawName, item.rawName) >= 0.85 && Math.abs(other.price - item.price) < 0.03);
    if (idx < 0) out.push(item);
    else if (item.rawName.length > out[idx].rawName.length) out[idx] = item;
  }
  return out;
}

function crop(source: HTMLCanvasElement, rect: Rect) {
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(source.width, Math.ceil(rect.x1));
  const y1 = Math.min(source.height, Math.ceil(rect.y1));
  const out = document.createElement("canvas");
  out.width = Math.max(1, x1 - x0); out.height = Math.max(1, y1 - y0);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Não foi possível preparar uma região do tabloide.");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function median(values: number[], fallback = 0) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rgbToHue(r: number, g: number, b: number) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const sat = max === 0 ? 0 : d / max;
  if (d === 0) return { h: 0, s: sat, v: max };
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = ((h * 60) + 360) % 360;
  return { h, s: sat, v: max };
}

function groups(points: number[]) {
  if (!points.length) return [] as number[];
  const out: number[] = [];
  let bucket = [points[0]];
  for (const value of points.slice(1)) {
    if (value <= bucket[bucket.length - 1] + 1) bucket.push(value);
    else { out.push(Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length)); bucket = [value]; }
  }
  out.push(Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length));
  return out;
}

function normalizeBoundaries(values: number[], max: number) {
  let points = [...values].sort((a, b) => a - b);
  if (points.length < 3) return points;
  let diffs = points.slice(1).map((v, i) => v - points[i]).filter((d) => d > max * 0.02);
  let gap = median(diffs, max / 5);
  const merged: number[] = [];
  for (const point of points) {
    if (merged.length && point - merged[merged.length - 1] < gap * 0.25) merged[merged.length - 1] = Math.round((merged[merged.length - 1] + point) / 2);
    else merged.push(point);
  }
  points = merged; diffs = points.slice(1).map((v, i) => v - points[i]); gap = median(diffs, gap);
  if (points[0] > gap * 0.45 && points[0] - gap >= 0) points.unshift(Math.round(points[0] - gap));
  if (max - points[points.length - 1] > gap * 0.45 && points[points.length - 1] + gap <= max) points.push(Math.round(points[points.length - 1] + gap));
  if (points[0] < gap * 0.15) points[0] = 0;
  if (max - points[points.length - 1] < gap * 0.15) points[points.length - 1] = max;
  let widths = points.slice(1).map((v, i) => v - points[i]); let typical = median(widths, gap);
  if (widths[0] < typical * 0.55) points = points.slice(1);
  widths = points.slice(1).map((v, i) => v - points[i]); typical = median(widths, gap);
  if (widths[widths.length - 1] < typical * 0.55) points = points.slice(0, -1);
  return points;
}

function detectGrid(canvas: HTMLCanvasElement): Grid | null {
  const targetWidth = Math.min(850, canvas.width);
  const scale = targetWidth / canvas.width;
  const small = document.createElement("canvas");
  small.width = targetWidth; small.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = small.getContext("2d", { willReadFrequently: true }); if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const data = ctx.getImageData(0, 0, small.width, small.height).data;
  const bins = 18, hist = new Array(bins).fill(0);
  for (let y = 0; y < small.height; y += 3) for (let x = 0; x < small.width; x += 3) {
    const i = (y * small.width + x) * 4; const hsv = rgbToHue(data[i], data[i + 1], data[i + 2]);
    if (hsv.s > 0.28 && hsv.v > 0.35) hist[Math.floor(hsv.h / 20) % bins]++;
  }
  const candidates = hist.map((count, bin) => ({ count, bin })).sort((a, b) => b.count - a.count).slice(0, 5);
  let best: { score: number; xs: number[]; ys: number[] } | null = null;
  for (const option of candidates) {
    const row = new Array(small.height).fill(0), col = new Array(small.width).fill(0);
    for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) {
      const i = (y * small.width + x) * 4; const hsv = rgbToHue(data[i], data[i + 1], data[i + 2]);
      const bin = Math.floor(hsv.h / 20) % bins; const dist = Math.min(Math.abs(bin - option.bin), bins - Math.abs(bin - option.bin));
      if (dist <= 1 && hsv.s > 0.28 && hsv.v > 0.35) { row[y]++; col[x]++; }
    }
    const ys = groups(row.map((count, i) => count / small.width > 0.3 ? i : -1).filter((i) => i >= 0));
    const xs = groups(col.map((count, i) => count / small.height > 0.3 ? i : -1).filter((i) => i >= 0));
    const score = xs.length + ys.length;
    if (!best || score > best.score) best = { score, xs, ys };
  }
  if (!best || best.score < 8) return null;
  const xs = normalizeBoundaries(best.xs.map((x) => Math.round(x / scale)), canvas.width - 1);
  const ys = normalizeBoundaries(best.ys.map((y) => Math.round(y / scale)), canvas.height - 1);
  if (xs.length < 5 || xs.length > 9 || ys.length < 5 || ys.length > 15) return null;
  const xw = xs.slice(1).map((v, i) => v - xs[i]), yw = ys.slice(1).map((v, i) => v - ys[i]);
  const xMed = median(xw, 1), yMed = median(yw, 1);
  const xDev = Math.max(...xw.map((v) => Math.abs(v - xMed) / xMed));
  const yDev = Math.max(...yw.map((v) => Math.abs(v - yMed) / yMed));
  return xDev <= 0.35 && yDev <= 0.35 ? { xs, ys } : null;
}

function makeRedPriceMask(cell: HTMLCanvasElement) {
  const startY = Math.floor(cell.height * 0.53);
  const out = document.createElement("canvas"); out.width = cell.width; out.height = cell.height - startY;
  const src = cell.getContext("2d", { willReadFrequently: true }); const dst = out.getContext("2d", { willReadFrequently: true });
  if (!src || !dst) return { canvas: out, ratio: 0 };
  const img = src.getImageData(0, startY, cell.width, out.height); const result = dst.createImageData(out.width, out.height);
  let hits = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const red = r > 90 && r > g * 1.35 && r > b * 1.25;
    const value = red ? 0 : 255; if (red) hits++;
    result.data[i] = result.data[i + 1] = result.data[i + 2] = value; result.data[i + 3] = 255;
  }
  dst.putImageData(result, 0, 0);
  return { canvas: out, ratio: hits / Math.max(1, out.width * out.height) };
}

async function readName(worker: any, cell: HTMLCanvasElement) {
  const full = await worker.recognize(cell); let text = full.data?.text ?? ""; let name = pickName(text);
  if (contentWords(name).length < 2) {
    const top = crop(cell, { x0: 0, y0: 0, x1: cell.width, y1: cell.height * 0.55 });
    const bottom = crop(cell, { x0: 0, y0: cell.height * 0.3, x1: cell.width, y1: cell.height });
    const topText = (await worker.recognize(top)).data?.text ?? "";
    const bottomText = (await worker.recognize(bottom)).data?.text ?? "";
    const options = [name, pickName(topText), pickName(bottomText)].filter(Boolean);
    name = options.sort((a, b) => contentWords(b).length - contentWords(a).length || nameScore(b) - nameScore(a))[0] ?? name;
    text = `${text}\n${topText}\n${bottomText}`;
  }
  return { name: fixCommonOcr(name), text, club: /clube\s*(de)?\s*vantagens?/i.test(text) };
}

async function readPrice(worker: any, cell: HTMLCanvasElement, rawText: string) {
  const explicit = explicitPrices(rawText)[0];
  const mask = makeRedPriceMask(cell);
  let visual: number | null = null;
  if (mask.ratio > 0.001) {
    const result = await worker.recognize(mask.canvas); visual = loosePrice(result.data?.text ?? "");
    if (!visual) {
      await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789,." });
      const retry = await worker.recognize(mask.canvas); visual = loosePrice(retry.data?.text ?? "");
      await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "0123456789,." });
    }
  }
  if (visual && explicit && Math.abs(visual - explicit) / Math.max(visual, explicit) > 0.55) return explicit;
  return visual ?? explicit ?? loosePrice(rawText);
}

async function extractGridPage(nameWorker: any, priceWorker: any, canvas: HTMLCanvasElement, grid: Grid, page: number, total: number, onProgress: Progress) {
  const out: FlyerCandidate[] = [];
  const cells: Rect[] = [];
  for (let row = 0; row < grid.ys.length - 1; row++) for (let col = 0; col < grid.xs.length - 1; col++) {
    cells.push({ x0: grid.xs[col] + 3, y0: grid.ys[row] + 3, x1: grid.xs[col + 1] - 3, y1: grid.ys[row + 1] - 3 });
  }
  for (let i = 0; i < cells.length; i++) {
    onProgress(page, total, `Página ${page}/${total} · lendo oferta ${i + 1}/${cells.length}`);
    const cell = crop(canvas, cells[i]);
    const nameData = await readName(nameWorker, cell);
    if (!plausibleName(nameData.name)) continue;
    const price = await readPrice(priceWorker, cell, nameData.text);
    if (!price) continue;
    const item = candidate(nameData.name, price, page, nameData.club); if (item) out.push(item);
  }
  return dedupe(out);
}

async function loosePage(worker: any, canvas: HTMLCanvasElement, page: number) {
  await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
  const result = await worker.recognize(canvas); const text = result.data?.text ?? "";
  await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
  return { text, candidates: parseFlyerText(text, page) };
}

async function imageToCanvas(file: File) {
  const bitmap = await createImageBitmap(file); const scale = Math.min(3, 2400 / bitmap.width);
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Não foi possível preparar a imagem.");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return canvas;
}

export async function readFlyerFileSmart(file: File, onProgress: Progress): Promise<SmartFlyerRead> {
  const Tesseract = await import("tesseract.js");
  const [nameWorker, priceWorker] = await Promise.all([Tesseract.createWorker("por"), Tesseract.createWorker("eng")]);
  await nameWorker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
  await priceWorker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "0123456789,.", preserve_interword_spaces: "1" });
  try {
    const pages: HTMLCanvasElement[] = [];
    if (file.type.startsWith("image/")) pages.push(await imageToCanvas(file));
    else {
      if (file.type !== "application/pdf") throw new Error("Envie um PDF ou uma imagem do tabloide.");
      const pdfjs = await import("pdfjs-dist"); pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        onProgress(n, pdf.numPages, `Preparando página ${n}/${pdf.numPages}…`);
        const page = await pdf.getPage(n); const viewport = page.getViewport({ scale: 3 });
        const canvas = document.createElement("canvas"); canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Não foi possível preparar a página.");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); await page.render({ canvasContext: ctx, viewport } as any).promise;
        pages.push(canvas);
      }
    }
    const all: FlyerCandidate[] = [], textByPage: string[] = []; let metaText = "";
    for (let i = 0; i < pages.length; i++) {
      const pageNo = i + 1, grid = detectGrid(pages[i]);
      if (pageNo === 1) {
        await nameWorker.setParameters({ tessedit_pageseg_mode: "11" });
        const meta = await nameWorker.recognize(pages[i]); metaText = meta.data?.text ?? "";
        await nameWorker.setParameters({ tessedit_pageseg_mode: "6" });
      }
      if (grid) {
        const items = await extractGridPage(nameWorker, priceWorker, pages[i], grid, pageNo, pages.length, onProgress);
        all.push(...items); textByPage.push(items.map((item) => `${item.rawName} ${item.price.toFixed(2)}`).join("\n"));
      } else {
        onProgress(pageNo, pages.length, `Página ${pageNo}/${pages.length} · leitura livre`);
        const loose = await loosePage(nameWorker, pages[i], pageNo); all.push(...loose.candidates); textByPage.push(loose.text);
      }
    }
    return { textByPage, metaText: metaText || textByPage[0] || "", pageCount: pages.length, candidates: dedupe(all) };
  } finally {
    await Promise.all([nameWorker.terminate(), priceWorker.terminate()]);
  }
}
