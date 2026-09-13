/**
 * Decodificação robusta de QR Code de cupom fiscal.
 *
 * Fotos de cupom costumam ter QR pequeno, com reflexo, tremido ou girado.
 * Por isso tentamos várias estratégias em sequência:
 *  1. BarcodeDetector nativo (quando existe)
 *  2. jsQR sobre o frame original, invertido, com contraste e em vários recortes/escalas
 *  3. zxing como último recurso
 */

type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: unknown
) => { data: string } | null;

let jsQrPromise: Promise<JsQrFn> | null = null;
const loadJsQr = () => {
  if (!jsQrPromise) {
    jsQrPromise = import("jsqr").then((m) => (m.default ?? m) as unknown as JsQrFn);
  }
  return jsQrPromise;
};

let detector: any = null;
let detectorTried = false;
const getDetector = () => {
  if (!detectorTried) {
    detectorTried = true;
    try {
      if ("BarcodeDetector" in window) {
        detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
      }
    } catch {
      detector = null;
    }
  }
  return detector;
};

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

type EnhanceMode = "gray" | "invert" | "threshold" | "adaptive" | "adaptiveInvert" | "contrast";

/** Extrai o canal de luminância da imagem. */
function toGray(img: ImageData): Uint8ClampedArray {
  const d = img.data;
  const grays = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0, g = 0; i < d.length; i += 4, g++) {
    grays[g] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
  }
  return grays;
}

/** Alongamento de histograma por percentis (aumento de contraste agressivo). */
function stretchContrast(grays: Uint8ClampedArray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grays.length; i++) hist[grays[i]]++;
  const cut = Math.max(1, Math.round(grays.length * 0.02));
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= cut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= cut) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  const out = new Uint8ClampedArray(grays.length);
  for (let i = 0; i < grays.length; i++) {
    out[i] = ((grays[i] - lo) * 255) / range;
  }
  return out;
}

/**
 * Binarização adaptativa (média local via imagem integral, tipo Bradley).
 * Lida com reflexo, sombra e iluminação irregular na foto do cupom.
 */
function adaptiveBinarize(grays: Uint8ClampedArray, w: number, h: number, invert: boolean) {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += grays[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const radius = Math.max(4, Math.floor(Math.min(w, h) / 24));
  const out = new Uint8ClampedArray(grays.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integral[y0 * (w + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];
      const mean = sum / area;
      const idx = y * w + x;
      // t = 0.86 => pixel precisa ser ~14% mais escuro que a vizinhança
      let v = grays[idx] * 1 < mean * 0.86 ? 0 : 255;
      if (invert) v = 255 - v;
      out[idx] = v;
    }
  }
  return out;
}

function fromGray(grays: Uint8ClampedArray, w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let g = 0, i = 0; g < grays.length; g++, i += 4) {
    data[i] = data[i + 1] = data[i + 2] = grays[g];
    data[i + 3] = 255;
  }
  return new ImageData(data, w, h);
}

/** Aplica um pré-processamento específico à imagem. */
function enhance(img: ImageData, mode: EnhanceMode): ImageData {
  const { width: w, height: h } = img;
  const grays = toGray(img);
  if (mode === "gray") return fromGray(grays, w, h);
  if (mode === "contrast") return fromGray(stretchContrast(grays), w, h);
  if (mode === "invert") {
    const out = new Uint8ClampedArray(grays.length);
    for (let i = 0; i < grays.length; i++) out[i] = 255 - grays[i];
    return fromGray(out, w, h);
  }
  if (mode === "adaptive" || mode === "adaptiveInvert") {
    return fromGray(adaptiveBinarize(stretchContrast(grays), w, h, mode === "adaptiveInvert"), w, h);
  }
  // limiar global (média)
  let sum = 0;
  for (let i = 0; i < grays.length; i++) sum += grays[i];
  const mean = sum / grays.length;
  const out = new Uint8ClampedArray(grays.length);
  for (let i = 0; i < grays.length; i++) out[i] = grays[i] > mean ? 255 : 0;
  return fromGray(out, w, h);
}

const FAST_MODES: EnhanceMode[] = ["gray", "adaptive", "contrast"];
const FULL_MODES: EnhanceMode[] = ["gray", "contrast", "adaptive", "adaptiveInvert", "threshold", "invert"];

async function tryJsQr(img: ImageData, fast = false): Promise<string | null> {
  const jsQR = await loadJsQr();
  for (const mode of fast ? FAST_MODES : FULL_MODES) {
    const prepared = enhance(img, mode);
    const hit = jsQR(prepared.data, prepared.width, prepared.height, {
      inversionAttempts: "attemptBoth",
    })?.data;
    if (hit) return hit.trim();
  }
  return null;
}

/** Gira a imagem em um ângulo (graus) devolvendo um novo canvas. */
function rotatedCanvas(source: CanvasImageSource, w: number, h: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rw = Math.round(w * cos + h * sin);
  const rh = Math.round(w * sin + h * cos);
  const canvas = makeCanvas(rw, rh);
  const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, rw, rh);
  ctx.translate(rw / 2, rh / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  return canvas;
}

function imageDataFrom(source: CanvasImageSource, w: number, h: number, crop?: [number, number, number, number]) {
  const [sx, sy, sw, sh] = crop ?? [0, 0, w, h];
  const canvas = makeCanvas(sw, sh);
  const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return ctx.getImageData(0, 0, sw, sh);
}

function scaledImageData(source: CanvasImageSource, w: number, h: number, factor: number) {
  const sw = Math.max(80, Math.round(w * factor));
  const sh = Math.max(80, Math.round(h * factor));
  const canvas = makeCanvas(sw, sh);
  const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h, 0, 0, sw, sh);
  return ctx.getImageData(0, 0, sw, sh);
}

export interface DecodeOptions {
  /** true = varredura rápida (loop da câmera). false = esforço total (foto). */
  fast?: boolean;
  /** Recebe o andamento de cada mecanismo para diagnóstico na interface. */
  onStatus?: (event: DecodeStatusEvent) => void;
}

export type DecodeMethod = "BarcodeDetector" | "jsQR" | "zxing";
export type DecodeMethodStatus = "running" | "success" | "failed" | "unavailable" | "skipped";

export interface DecodeStatusEvent {
  method: DecodeMethod;
  status: DecodeMethodStatus;
  reason: string;
}

const errorReason = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  return "Erro não identificado pelo navegador";
};

/**
 * Tenta decodificar um QR Code de um vídeo, imagem ou canvas.
 * Retorna o texto ou null.
 */
export async function decodeQrFromSource(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  { fast = false, onStatus }: DecodeOptions = {}
): Promise<string | null> {
  const w =
    (source as HTMLVideoElement).videoWidth ||
    (source as HTMLImageElement).naturalWidth ||
    (source as HTMLCanvasElement).width;
  const h =
    (source as HTMLVideoElement).videoHeight ||
    (source as HTMLImageElement).naturalHeight ||
    (source as HTMLCanvasElement).height;
  if (!w || !h) {
    onStatus?.({ method: "BarcodeDetector", status: "failed", reason: "Imagem ainda sem dimensões disponíveis" });
    return null;
  }

  // frame base (tamanho cheio) em canvas — reaproveitado pelas tentativas
  const base = makeCanvas(w, h);
  const baseCtx = base.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D;
  baseCtx.drawImage(source, 0, 0, w, h);

  // 1) detector nativo
  const det = getDetector();
  if (det) {
    onStatus?.({ method: "BarcodeDetector", status: "running", reason: `Analisando quadro ${w}×${h}` });
    try {
      const codes = await det.detect(base);
      const raw = codes?.[0]?.rawValue;
      if (raw) {
        onStatus?.({ method: "BarcodeDetector", status: "success", reason: "QR Code detectado" });
        return String(raw).trim();
      }
      onStatus?.({ method: "BarcodeDetector", status: "failed", reason: "Nenhum QR detectado neste quadro" });
    } catch (error) {
      onStatus?.({ method: "BarcodeDetector", status: "failed", reason: errorReason(error) });
    }
  } else {
    onStatus?.({ method: "BarcodeDetector", status: "unavailable", reason: "API não suportada por este navegador" });
  }

  // 2) jsQR — frame cheio
  onStatus?.({ method: "jsQR", status: "running", reason: "Testando imagem inteira e variações de contraste" });
  const full = baseCtx.getImageData(0, 0, w, h);
  const direct = await tryJsQr(full, fast);
  if (direct) {
    onStatus?.({ method: "jsQR", status: "success", reason: "QR detectado na imagem inteira" });
    return direct;
  }

  // reduções: QR grande em foto de 12MP costuma falhar sem downscale
  const scales = fast ? [0.5] : [0.6, 0.4, 0.25, 1.5];
  for (const factor of scales) {
    if (Math.round(w * factor) < 80) continue;
    onStatus?.({ method: "jsQR", status: "running", reason: `Testando escala ${factor}×` });
    const hit = await tryJsQr(scaledImageData(base, w, h, factor), fast);
    if (hit) {
      onStatus?.({ method: "jsQR", status: "success", reason: `QR detectado na escala ${factor}×` });
      return hit;
    }
  }

  // rotações comuns: cupom torto na mão ou foto na horizontal
  const angles = fast ? [90, 270] : [90, 180, 270, 15, -15, 45, -45, 8, -8];
  for (const angle of angles) {
    onStatus?.({ method: "jsQR", status: "running", reason: `Testando rotação ${angle}°` });
    const rotated = rotatedCanvas(base, w, h, angle);
    const rctx = rotated.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D;
    const hit = await tryJsQr(rctx.getImageData(0, 0, rotated.width, rotated.height), fast);
    if (hit) {
      onStatus?.({ method: "jsQR", status: "success", reason: `QR detectado com rotação ${angle}°` });
      return hit;
    }
    if (!fast && Math.min(rotated.width, rotated.height) > 700) {
      const small = scaledImageData(rotated, rotated.width, rotated.height, 0.5);
      const smallHit = await tryJsQr(small, false);
      if (smallHit) {
        onStatus?.({ method: "jsQR", status: "success", reason: `QR detectado com rotação ${angle}° reduzida` });
        return smallHit;
      }
    }
  }

  // recortes (centro e quadrantes) — ajuda quando o QR ocupa pouca área da foto
  const crops: Array<[number, number, number, number]> = fast
    ? [[w * 0.2, h * 0.2, w * 0.6, h * 0.6]]
    : [
        [w * 0.25, h * 0.25, w * 0.5, h * 0.5],
        [0, 0, w * 0.55, h * 0.55],
        [w * 0.45, 0, w * 0.55, h * 0.55],
        [0, h * 0.45, w * 0.55, h * 0.55],
        [w * 0.45, h * 0.45, w * 0.55, h * 0.55],
        [0, h * 0.5, w, h * 0.5],
        [0, 0, w, h * 0.5],
      ];
  for (const [cropIndex, crop] of crops.entries()) {
    const rect = crop.map((n) => Math.round(n)) as [number, number, number, number];
    if (rect[2] < 80 || rect[3] < 80) continue;
    onStatus?.({ method: "jsQR", status: "running", reason: `Testando recorte ${cropIndex + 1} de ${crops.length}` });
    const cropData = imageDataFrom(base, w, h, rect);
    const hit = await tryJsQr(cropData, fast);
    if (hit) {
      onStatus?.({ method: "jsQR", status: "success", reason: `QR detectado no recorte ${cropIndex + 1}` });
      return hit;
    }
    if (!fast) {
      const zoomed = makeCanvas(rect[2] * 2, rect[3] * 2);
      const zctx = zoomed.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D;
      zctx.imageSmoothingEnabled = true;
      zctx.drawImage(base, rect[0], rect[1], rect[2], rect[3], 0, 0, zoomed.width, zoomed.height);
      const zoomHit = await tryJsQr(zctx.getImageData(0, 0, zoomed.width, zoomed.height), false);
      if (zoomHit) {
        onStatus?.({ method: "jsQR", status: "success", reason: `QR detectado no recorte ampliado ${cropIndex + 1}` });
        return zoomHit;
      }
      // recorte girado: QR pequeno e torto no canto do cupom
      for (const angle of [90, 20, -20]) {
        const rotCrop = rotatedCanvas(zoomed, zoomed.width, zoomed.height, angle);
        const rc = rotCrop.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D;
        const rotHit = await tryJsQr(rc.getImageData(0, 0, rotCrop.width, rotCrop.height), false);
        if (rotHit) {
          onStatus?.({
            method: "jsQR",
            status: "success",
            reason: `QR detectado no recorte ${cropIndex + 1} girado ${angle}°`,
          });
          return rotHit;
        }
      }
    }
  }
  onStatus?.({
    method: "jsQR",
    status: "failed",
    reason: "Nenhum padrão QR legível após escalas, rotações, binarização adaptativa e recortes",
  });

  // 3) zxing (só no modo esforço total — é lento)
  if (!fast) {
    onStatus?.({ method: "zxing", status: "running", reason: "Executando último método de leitura" });
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const text = (await reader.decodeFromImageUrl(base.toDataURL("image/png")))?.getText();
      if (text) {
        onStatus?.({ method: "zxing", status: "success", reason: "QR Code detectado" });
        return text.trim();
      }
      onStatus?.({ method: "zxing", status: "failed", reason: "Nenhum QR detectado" });
    } catch (error) {
      onStatus?.({ method: "zxing", status: "failed", reason: errorReason(error) });
    }
  } else {
    onStatus?.({ method: "zxing", status: "skipped", reason: "Reservado para Capturar agora ou leitura de foto" });
  }

  return null;
}

/** Decodifica um arquivo de imagem (foto do cupom). */
export async function decodeQrFromFile(file: File, options: Omit<DecodeOptions, "fast"> = {}): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });
    }
    return await decodeQrFromSource(img, { ...options, fast: false });
  } finally {
    URL.revokeObjectURL(url);
  }
}
