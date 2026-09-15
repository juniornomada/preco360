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

function hasPrice(line: string) {
  return linePrices(line).length > 0;
}

function buildName(lines: string[], lineIndex: number, priceStart: number) {
  const fragments: string[] = [];
  const sameLine = cleanName(lines[lineIndex].slice(0, priceStart));
  if (plausibleProductName(sameLine)) fragments.unshift(sameLine);

  for (let j = lineIndex - 1; j >= Math.max(0, lineIndex - 4); j--) {
    const raw = lines[j];
    if (!raw.trim()) break;
    if (hasPrice(raw)) break;
    const candidate = cleanName(raw);
    if (!candidate) continue;
    if (isMarketingLine(candidate)) continue;
    if (candidate.length <= 2) continue;
    fragments.unshift(candidate);
    if (fragments.join(" ").length > 100) break;
  }

  let name = cleanName(fragments.join(" "));
  if (name.length > 120) {
    const parts = name.split(/\s+/);
    while (parts.join(" ").length > 120 && parts.length > 2) parts.shift();
    name = parts.join(" ");
  }
  return plausibleProductName(name) ? name : sameLine;
}

function dedupeCandidates(items: FlyerCandidate[]) {
  const result: FlyerCandidate[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.price) || item.price < 0.2 || item.price > 500) continue;
    if (!plausibleProductName(item.rawName)) continue;

    const normalized = normalizeSearchText(item.rawName);
    const words = new Set(normalized.split(/\s+/).filter((word) => word.length >= 3));
    const duplicateIndex = result.findIndex((existing) => {
      if (Math.abs(existing.price - item.price) > 0.011) return false;
      const other = normalizeSearchText(existing.rawName);
      if (other === normalized || other.includes(normalized) || normalized.includes(other)) return true;
      const otherWords = new Set(other.split(/\s+/).filter((word) => word.length >= 3));
      const intersection = [...words].filter((word) => otherWords.has(word)).length;
      const union = new Set([...words, ...otherWords]).size;
      return union > 0 && intersection / union >= 0.7;
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
      const rawName = buildName(lines, i, match.index);
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

function cropCanvas(source: HTMLCanvasElement, x: number, width: number) {
  const padding = 18;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width + padding * 2));
  canvas.height = source.height + padding * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Não foi possível preparar uma região do tabloide.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, x, 0, width, source.height, padding, padding, width, source.height);
  return canvas;
}

async function fileToCanvas(file: File) {
  const bitmap = await createImageBitmap(file);
  const targetWidth = Math.min(2400, Math.max(1600, bitmap.width));
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

async function recognize(worker: any, canvas: HTMLCanvasElement, mode: "sparse" | "block") {
  await worker.setParameters({
    tessedit_pageseg_mode: mode === "sparse" ? "11" : "6",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(canvas);
  return result.data?.text ?? "";
}

async function readColumns(
  worker: any,
  canvas: HTMLCanvasElement,
  columns: number,
  page: number,
  total: number,
  onProgress: Progress,
) {
  const texts: string[] = [];
  const candidates: FlyerCandidate[] = [];
  const baseWidth = canvas.width / columns;
  const overlap = Math.min(50, baseWidth * 0.08);

  for (let col = 0; col < columns; col++) {
    const left = Math.max(0, Math.floor(col * baseWidth - overlap));
    const right = Math.min(canvas.width, Math.ceil((col + 1) * baseWidth + overlap));
    onProgress(page, total, `Página ${page}/${total} · faixa ${col + 1}/${columns}`);
    const text = await recognize(worker, cropCanvas(canvas, left, right - left), "block");
    texts.push(text);
    candidates.push(...parseChunk(text, page));
  }

  return { text: texts.join("\n\n"), candidates: dedupeCandidates(candidates) };
}

async function analyzeCanvas(worker: any, canvas: HTMLCanvasElement, page: number, total: number, onProgress: Progress) {
  let metaText = "";
  if (page === 1) {
    onProgress(page, total, `Página ${page}/${total} · identificando mercado e validade`);
    metaText = await recognize(worker, canvas, "sparse");
  }

  const five = await readColumns(worker, canvas, 5, page, total, onProgress);
  let best = five;

  if (five.candidates.length < 10) {
    const three = await readColumns(worker, canvas, 3, page, total, onProgress);
    if (three.candidates.length > best.candidates.length) best = three;
  }

  return { text: best.text, metaText: metaText || best.text, candidates: best.candidates };
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
    const allCandidates: FlyerCandidate[] = [];
    let metaText = "";

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      onProgress(pageNumber, pdf.numPages, `Preparando página ${pageNumber}/${pdf.numPages}…`);

      const textContent = await page.getTextContent();
      const embedded = textContent.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join("\n")
        .trim();
      const embeddedCandidates = parseChunk(embedded, pageNumber);

      if (embeddedCandidates.length >= 8) {
        textByPage.push(embedded);
        allCandidates.push(...embeddedCandidates);
        if (pageNumber === 1) metaText = embedded;
        continue;
      }

      const viewport = page.getViewport({ scale: 2.25 });
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
