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
type OcrWord = { text: string; confidence: number; bbox: Rect };
type OcrLine = { text: string; confidence: number; bbox: Rect; words: OcrWord[] };

const PRICE_RE = /(?:R\$\s*)?(\d{1,3})\s*[,.:]\s*(\d{2})\b/;
const STOP = new Set(["e", "de", "da", "do", "das", "dos", "ou", "com", "sem", "tipo", "tipos", "kg", "g", "ml", "l", "unidade", "unidades"]);

const WORD_FIXES: Record<string, string> = {
  logarto: "Lagarto",
  lagorto: "Lagarto",
  frocionada: "Fracionada",
  frocionado: "Fracionado",
  bondeja: "bandeja",
  perolo: "Pérola",
  perola: "Pérola",
  mportada: "importada",
  forinha: "Farinha",
  hocibra: "Hochibra",
  hodhibro: "Hochibra",
  hochibro: "Hochibra",
  shimei: "Shimeji",
  shimeii: "Shimeji",
  shimej: "Shimeji",
  ramo: "Rama",
  tibirica: "Tibiriçá",
  maco: "Maçã",
  maca: "Maçã",
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

function packageLike(value: string) {
  const text = normalizeSearchText(value);
  return /\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|lt|un|und|unid)\b/i.test(text)
    || /\b(?:kg|unidade|unidades)\b/i.test(text);
}

function suspiciousToken(value: string) {
  const token = clean(value);
  if (!token) return true;
  if (/^[A-Za-zÀ-ÿ]{1}$/.test(token)) return true;
  if (/\d+[A-Za-zÀ-ÿ]+/.test(token) && !/\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|lt|un|und|unid)$/i.test(token)) return true;
  const odd = (token.match(/[^A-Za-zÀ-ÿ0-9.,/%+&()-]/g) ?? []).length;
  return odd > Math.max(1, token.length * 0.18);
}

function nameScore(value: string) {
  const normalized = fixCommonOcr(value);
  const words = contentWords(normalized);
  let score = words.length * 2 + Math.min(normalized.length, 70) / 35;
  if (/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|lt)\b/i.test(normalized)) score += 3;
  if (/\b(?:kg|unidade|tipos?)\b/i.test(normalized)) score += 1.5;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  score -= tokens.filter(suspiciousToken).length * 1.8;
  score -= tokens.filter((word) => word.length === 1).length * 2;
  return score;
}

function pickName(text: string) {
  const lines = text.split(/\r?\n/).map(clean).filter((line) => plausibleName(line) || packageLike(line))
    .filter((line) => (line.match(/\d/g) ?? []).length < Math.max(6, line.length * 0.6));
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
  const fixed = fixCommonOcr(rawName);
  const packageInfo = inferPackage(fixed);
  const normalized = normalizedUnitPrice(price, packageInfo);
  const item: FlyerCandidate = {
    rawName: fixed, price, packageInfo,
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
    else if (nameScore(item.rawName) > nameScore(out[idx].rawName)) out[idx] = item;
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

function upscale(source: HTMLCanvasElement, factor = 1.7) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * factor));
  out.height = Math.max(1, Math.round(source.height * factor));
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, out.width, out.height);
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

function isRed(r: number, g: number, b: number) {
  return r > 90 && r > g * 1.35 && r > b * 1.25;
}

function redPriceBand(cell: HTMLCanvasElement) {
  const ctx = cell.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const image = ctx.getImageData(0, 0, cell.width, cell.height).data;
  const start = Math.floor(cell.height * 0.43);
  const rows = new Array(cell.height).fill(0);
  for (let y = start; y < cell.height; y++) {
    let hits = 0;
    for (let x = 0; x < cell.width; x++) {
      const i = (y * cell.width + x) * 4;
      if (isRed(image[i], image[i + 1], image[i + 2])) hits++;
    }
    rows[y] = hits / Math.max(1, cell.width);
  }
  const smooth = rows.map((_, y) => {
    let sum = 0, count = 0;
    for (let k = -4; k <= 4; k++) {
      const yy = y + k;
      if (yy >= 0 && yy < rows.length) { sum += rows[yy]; count++; }
    }
    return count ? sum / count : 0;
  });
  const active = smooth.map((value, y) => y >= start && value > 0.008 ? y : -1).filter((y) => y >= 0);
  if (!active.length) return null;
  const bands: Array<{ y0: number; y1: number; strength: number }> = [];
  let y0 = active[0], prev = active[0];
  for (const y of active.slice(1)) {
    if (y <= prev + 4) prev = y;
    else {
      const strength = smooth.slice(y0, prev + 1).reduce((a, b) => a + b, 0);
      if (strength > 1.3) bands.push({ y0, y1: prev, strength });
      y0 = prev = y;
    }
  }
  const strength = smooth.slice(y0, prev + 1).reduce((a, b) => a + b, 0);
  if (strength > 1.3) bands.push({ y0, y1: prev, strength });
  return bands.length ? bands[bands.length - 1] : null;
}

function makeRedPriceMask(cell: HTMLCanvasElement) {
  const band = redPriceBand(cell);
  const startY = band ? Math.max(0, band.y0 - Math.round(cell.height * 0.03)) : Math.floor(cell.height * 0.53);
  const endY = band ? Math.min(cell.height, band.y1 + Math.round(cell.height * 0.05)) : cell.height;
  const out = document.createElement("canvas"); out.width = cell.width; out.height = Math.max(1, endY - startY);
  const src = cell.getContext("2d", { willReadFrequently: true }); const dst = out.getContext("2d", { willReadFrequently: true });
  if (!src || !dst) return { canvas: out, ratio: 0, band };
  const img = src.getImageData(0, startY, cell.width, out.height); const result = dst.createImageData(out.width, out.height);
  let hits = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const red = isRed(img.data[i], img.data[i + 1], img.data[i + 2]);
    const value = red ? 0 : 255; if (red) hits++;
    result.data[i] = result.data[i + 1] = result.data[i + 2] = value; result.data[i + 3] = 255;
  }
  dst.putImageData(result, 0, 0);
  return { canvas: out, ratio: hits / Math.max(1, out.width * out.height), band };
}

function flattenOcrLines(blocks: any[] | null | undefined): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const block of blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) {
    if (!line?.bbox) continue;
    const words: OcrWord[] = (line.words ?? []).map((word: any) => ({
      text: clean(word.text ?? ""),
      confidence: Number(word.confidence ?? 0),
      bbox: word.bbox,
    })).filter((word: OcrWord) => !!word.text && !!word.bbox);
    const text = clean(line.text ?? words.map((word) => word.text).join(" "));
    if (!text) continue;
    lines.push({ text, confidence: Number(line.confidence ?? 0), bbox: line.bbox, words });
  }
  return lines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

function numericLine(line: OcrLine) {
  const text = clean(line.text);
  const digits = (text.match(/\d/g) ?? []).length;
  const letters = (normalizeSearchText(text).match(/[a-z]/g) ?? []).length;
  return digits >= 2 && (letters <= 2 || explicitPrices(text).length > 0);
}

function cleanWordsFromLine(line: OcrLine) {
  if (!line.words.length) return clean(line.text);
  const kept = line.words.filter((word) => {
    if (word.confidence >= 38) return true;
    if (packageLike(word.text)) return true;
    return false;
  }).map((word) => word.text);
  return clean(kept.join(" "));
}

function lineNeedsReread(line: OcrLine, base: string) {
  if (line.confidence < 68) return true;
  if (line.words.some((word) => word.confidence < 55 && word.text.length >= 2)) return true;
  if (base.split(/\s+/).some(suspiciousToken)) return true;
  return false;
}

async function rereadLine(worker: any, cell: HTMLCanvasElement, line: OcrLine) {
  const padX = Math.max(8, (line.bbox.x1 - line.bbox.x0) * 0.08);
  const padY = Math.max(5, (line.bbox.y1 - line.bbox.y0) * 0.22);
  const region = crop(cell, {
    x0: line.bbox.x0 - padX,
    y0: line.bbox.y0 - padY,
    x1: line.bbox.x1 + padX,
    y1: line.bbox.y1 + padY,
  });
  await worker.setParameters({ tessedit_pageseg_mode: "7", preserve_interword_spaces: "1" });
  const result = await worker.recognize(upscale(region, 1.55));
  await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
  return fixCommonOcr(clean(result.data?.text ?? ""));
}

function lineCandidateScore(value: string, confidence = 0) {
  if (!value) return -99;
  let score = nameScore(value) + Math.min(1.5, confidence / 70);
  if (plausibleName(value)) score += 2;
  if (packageLike(value)) score += 1.5;
  score -= value.split(/\s+/).filter(suspiciousToken).length * 1.4;
  return score;
}

async function spatialName(worker: any, cell: HTMLCanvasElement, blocks: any[] | null | undefined, fallbackText: string) {
  const lines = flattenOcrLines(blocks);
  const band = redPriceBand(cell);
  let anchorY = band?.y0 ?? 0;
  if (!anchorY) {
    const priceLines = lines.filter(numericLine).filter((line) => line.bbox.y0 > cell.height * 0.4);
    anchorY = priceLines.length ? Math.min(...priceLines.map((line) => line.bbox.y0)) : Math.round(cell.height * 0.82);
  }
  const minY = Math.max(0, anchorY - cell.height * 0.38);
  const maxY = Math.min(cell.height, anchorY + cell.height * 0.025);
  let selected = lines.filter((line) => line.bbox.y1 >= minY && line.bbox.y0 <= maxY)
    .filter((line) => !numericLine(line))
    .filter((line) => plausibleName(cleanWordsFromLine(line)) || packageLike(cleanWordsFromLine(line)) || plausibleName(line.text));

  if (!selected.length) {
    selected = lines.filter((line) => line.bbox.y0 > cell.height * 0.3 && line.bbox.y0 < cell.height * 0.82)
      .filter((line) => !numericLine(line))
      .filter((line) => plausibleName(cleanWordsFromLine(line)) || packageLike(cleanWordsFromLine(line)));
  }

  const refined: Array<{ text: string; y: number; score: number }> = [];
  for (const line of selected.slice(-5)) {
    const base = fixCommonOcr(cleanWordsFromLine(line) || line.text);
    let best = base;
    let bestScore = lineCandidateScore(base, line.confidence);
    if (lineNeedsReread(line, base)) {
      const reread = await rereadLine(worker, cell, line);
      const rereadScore = lineCandidateScore(reread, Number(line.confidence ?? 0));
      if (rereadScore > bestScore + 0.15) { best = reread; bestScore = rereadScore; }
    }
    if (plausibleName(best) || packageLike(best)) refined.push({ text: best, y: line.bbox.y0, score: bestScore });
  }

  refined.sort((a, b) => a.y - b.y);
  let joined = fixCommonOcr(refined.map((entry) => entry.text).join(" "));
  const fallback = pickName(fallbackText);
  if (!plausibleName(joined) || nameScore(fallback) > nameScore(joined) + 3.5) joined = fallback;
  return joined;
}

async function readName(worker: any, cell: HTMLCanvasElement) {
  const full = await worker.recognize(cell, {}, { text: true, blocks: true });
  let text = full.data?.text ?? "";
  let name = await spatialName(worker, cell, full.data?.blocks ?? [], text);

  if (contentWords(name).length < 2 || nameScore(name) < 4) {
    const band = redPriceBand(cell);
    const anchorY = band?.y0 ?? Math.round(cell.height * 0.8);
    const nameRegion = crop(cell, {
      x0: 0,
      y0: Math.max(0, anchorY - cell.height * 0.36),
      x1: cell.width,
      y1: Math.min(cell.height, anchorY + cell.height * 0.02),
    });
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    const local = await worker.recognize(upscale(nameRegion, 1.35));
    const localText = local.data?.text ?? "";
    const localName = pickName(localText);
    if (nameScore(localName) > nameScore(name)) name = localName;
    text = `${text}\n${localText}`;
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
      const retry = await worker.recognize(upscale(mask.canvas, 1.45)); visual = loosePrice(retry.data?.text ?? "");
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
    onProgress(page, total, `Página ${page}/${total} · refinando nome ${i + 1}/${cells.length}`);
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
  return { text, candidates: parseFlyerText(text, page).map((item) => ({ ...item, rawName: fixCommonOcr(item.rawName) })) };
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
