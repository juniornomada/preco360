import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Image as ImageIcon,
  Loader2,
  Minus,
  Plus,
  ScanLine,
  Zap,
  ZapOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { decodeQrFromSource } from "@/lib/qrDecode";

interface QrScannerProps {
  onResult: (text: string) => void;
  onClose?: () => void;
}

type Status = "idle" | "starting" | "scanning" | "reading";
type JsQr = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: unknown,
) => { data: string } | null;
type Source = HTMLVideoElement | HTMLImageElement;

type ExtendedTrackCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  zoom?: {
    min: number;
    max: number;
    step?: number;
  };
};

type ExtendedTrackConstraintSet = MediaTrackConstraintSet & {
  torch?: boolean;
  focusMode?: string;
  zoom?: number;
};

type ExtendedTrackSettings = MediaTrackSettings & { zoom?: number };
type CameraZoomRange = { min: number; max: number; step: number };

type BarcodeDetectorLike = {
  detect: (
    image: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  ) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => BarcodeDetectorLike;

let jsQrPromise: Promise<JsQr> | null = null;
let barcodeDetector: BarcodeDetectorLike | null | undefined;

const loadJsQr = () => {
  if (!jsQrPromise) {
    jsQrPromise = import("jsqr").then(
      (module) => (module.default ?? module) as unknown as JsQr,
    );
  }
  return jsQrPromise;
};

function getBarcodeDetector() {
  if (barcodeDetector !== undefined) return barcodeDetector;
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) {
    barcodeDetector = null;
    return null;
  }

  try {
    const Detector = (
      window as typeof window & {
        BarcodeDetector?: BarcodeDetectorConstructor;
      }
    ).BarcodeDetector;

    barcodeDetector = Detector
      ? new Detector({ formats: ["qr_code"] })
      : null;
  } catch {
    barcodeDetector = null;
  }

  return barcodeDetector;
}

function getSourceSize(source: Source) {
  return source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.naturalWidth, height: source.naturalHeight };
}

function drawRegion(
  source: Source,
  maxSide: number,
  squareRatio?: number,
  upscale = false,
  centerX = 0.5,
  centerY = 0.5,
) {
  const { width: sourceWidth, height: sourceHeight } = getSourceSize(source);
  if (!sourceWidth || !sourceHeight) return null;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (squareRatio) {
    const side = Math.min(sourceWidth, sourceHeight) * squareRatio;
    sw = side;
    sh = side;
    sx = Math.max(0, Math.min(sourceWidth - side, sourceWidth * centerX - side / 2));
    sy = Math.max(0, Math.min(sourceHeight - side, sourceHeight * centerY - side / 2));
  }

  const naturalScale = maxSide / Math.max(sw, sh);
  const scale = upscale
    ? Math.min(2.25, Math.max(1, naturalScale))
    : Math.min(1, naturalScale);
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);

  return canvas;
}

function enhancedCanvas(
  source: HTMLCanvasElement,
  mode: "contrast" | "threshold",
) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!context || !sourceContext) return null;

  const image = sourceContext.getImageData(0, 0, source.width, source.height);
  const data = image.data;

  for (let index = 0; index < data.length; index += 4) {
    const luminance =
      data[index] * 0.299 +
      data[index + 1] * 0.587 +
      data[index + 2] * 0.114;

    let value: number;
    if (mode === "threshold") {
      value = luminance < 150 ? 0 : 255;
    } else {
      value = Math.max(0, Math.min(255, (luminance - 128) * 1.65 + 128));
    }

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

async function decodeNative(source: Source | HTMLCanvasElement) {
  const detector = getBarcodeDetector();
  if (!detector) return null;

  try {
    const codes = await detector.detect(source);
    return codes[0]?.rawValue?.trim() || null;
  } catch {
    return null;
  }
}

async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const native = await decodeNative(canvas);
  if (native) return native;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const jsQr = await loadJsQr();

  return (
    jsQr(image.data, canvas.width, canvas.height, {
      inversionAttempts: "attemptBoth",
    })?.data?.trim() ?? null
  );
}

async function decodeCanvasVariants(canvas: HTMLCanvasElement) {
  const direct = await decodeCanvas(canvas);
  if (direct) return direct;

  const contrast = enhancedCanvas(canvas, "contrast");
  if (contrast) {
    const contrastValue = await decodeCanvas(contrast);
    if (contrastValue) return contrastValue;
  }

  const threshold = enhancedCanvas(canvas, "threshold");
  if (threshold) {
    const thresholdValue = await decodeCanvas(threshold);
    if (thresholdValue) return thresholdValue;
  }

  return null;
}

async function readQr(
  source: Source,
  thorough = false,
  useExtraDecoders = false,
): Promise<string | null> {
  // BarcodeDetector can work directly on the original video/image frame.
  // Avoiding an intermediate canvas preserves maximum camera detail.
  const nativeDirect = await decodeNative(source);
  if (nativeDirect) return nativeDirect;

  const isVideo = source instanceof HTMLVideoElement;
  const attempts: Array<{
    maxSide: number;
    squareRatio?: number;
    upscale?: boolean;
    enhanced?: boolean;
    centerX?: number;
    centerY?: number;
  }> = isVideo
    ? thorough
      ? [
          // Tight crops help dense NFC-e QR codes occupy many more pixels.
          { maxSide: 2200, squareRatio: 0.46, upscale: true, enhanced: true },
          { maxSide: 2200, squareRatio: 0.58, upscale: true, enhanced: true },
          { maxSide: 2200, squareRatio: 0.7, upscale: true, enhanced: true },
          // Small QR codes are not always perfectly centered in the preview.
          { maxSide: 1800, squareRatio: 0.52, centerX: 0.28, centerY: 0.3 },
          { maxSide: 1800, squareRatio: 0.52, centerX: 0.72, centerY: 0.3 },
          { maxSide: 1800, squareRatio: 0.52, centerX: 0.28, centerY: 0.7 },
          { maxSide: 1800, squareRatio: 0.52, centerX: 0.72, centerY: 0.7 },
          { maxSide: 2200, squareRatio: 0.86, enhanced: true },
          { maxSide: 2200, squareRatio: 1, enhanced: true },
          { maxSide: 2200, enhanced: true },
        ]
      : [
          { maxSide: 1800, squareRatio: 0.52 },
          { maxSide: 1800, squareRatio: 0.72 },
        ]
    : thorough
      ? [
          { maxSide: 2600, squareRatio: 0.5, upscale: true, enhanced: true },
          { maxSide: 2600, squareRatio: 0.7, upscale: true, enhanced: true },
          { maxSide: 1800, squareRatio: 0.5, centerX: 0.27, centerY: 0.27, enhanced: true },
          { maxSide: 1800, squareRatio: 0.5, centerX: 0.73, centerY: 0.27, enhanced: true },
          { maxSide: 1800, squareRatio: 0.5, centerX: 0.27, centerY: 0.73, enhanced: true },
          { maxSide: 1800, squareRatio: 0.5, centerX: 0.73, centerY: 0.73, enhanced: true },
          { maxSide: 2600, enhanced: true },
        ]
      : [{ maxSide: 1800 }];

  for (const attempt of attempts) {
    const canvas = drawRegion(
      source,
      attempt.maxSide,
      attempt.squareRatio,
      attempt.upscale,
      attempt.centerX,
      attempt.centerY,
    );
    if (!canvas) continue;

    const value = attempt.enhanced
      ? await decodeCanvasVariants(canvas)
      : await decodeCanvas(canvas);

    if (value) return value;
  }

  // The QR lab already includes a third decoding engine (ZXing) plus
  // adaptive thresholding and rotations. Reserve it for explicit scans or
  // captured photos to avoid blocking the live camera loop.
  if (useExtraDecoders) {
    const fallback = drawRegion(source, 1200, isVideo ? 0.75 : undefined);
    if (fallback) {
      const value = await decodeQrFromSource(fallback, { fast: false });
      if (value) return value;
    }
  }

  return null;
}

export function QrScanner({ onResult, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const thoroughTimerRef = useRef<number | null>(null);
  const readingRef = useRef(false);
  const finishedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState(
    "Aponte a câmera para o QR Code",
  );
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<CameraZoomRange | null>(null);
  const [zoomValue, setZoomValue] = useState<number | null>(null);
  const zoomUpdatingRef = useRef(false);
  const zoomRangeRef = useRef<CameraZoomRange | null>(null);
  const zoomValueRef = useRef<number | null>(null);
  const torchSupportedRef = useRef(false);
  const torchOnRef = useRef(false);
  const autoTorchOnRef = useRef(false);
  const manualTorchRef = useRef(false);
  const manualZoomRef = useRef(false);
  const autoLightRef = useRef(false);
  const scanSessionRef = useRef(0);
  const scanStartedAtRef = useRef(0);
  const lastZoomStepRef = useRef(0);
  const lastDeepScanRef = useRef(0);
  const lowLightSamplesRef = useRef(0);
  const assistBusyRef = useRef(false);
  const assistTimerRef = useRef<number | null>(null);
  const startupTimeoutRef = useRef<number | null>(null);
  const [lowLightDetected, setLowLightDetected] = useState(false);
  const [autoLightEnabled, setAutoLightEnabled] = useState(false);

  const stop = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
    }
    if (thoroughTimerRef.current !== null) {
      window.clearInterval(thoroughTimerRef.current);
    }
    if (assistTimerRef.current !== null) window.clearInterval(assistTimerRef.current);
    if (startupTimeoutRef.current !== null) window.clearTimeout(startupTimeoutRef.current);

    timerRef.current = null;
    thoroughTimerRef.current = null;
    assistTimerRef.current = null;
    startupTimeoutRef.current = null;
    scanSessionRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;

    readingRef.current = false;
    setStatus("idle");
    setTorchSupported(false);
    setTorchOn(false);
    setZoomRange(null);
    setZoomValue(null);
    zoomRangeRef.current = null;
    zoomValueRef.current = null;
    torchSupportedRef.current = false;
    torchOnRef.current = false;
    autoTorchOnRef.current = false;
    manualTorchRef.current = false;
    manualZoomRef.current = false;
    lowLightSamplesRef.current = 0;
    assistBusyRef.current = false;
    setLowLightDetected(false);
    zoomUpdatingRef.current = false;
  };

  useEffect(() => {
    try {
      const enabled = window.localStorage.getItem("preco360.qr.auto-light.v1") === "1";
      autoLightRef.current = enabled;
      setAutoLightEnabled(enabled);
    } catch {
      // Private browsing may disable persistent preferences.
    }
    return () => stop();
  }, []);

  const finish = (value: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    // Remember only the effective zoom, not the QR data.
    const trackSettings = streamRef.current?.getVideoTracks()[0]?.getSettings() as ExtendedTrackSettings | undefined;
    const successfulZoom = trackSettings?.zoom;
    if (successfulZoom && Number.isFinite(successfulZoom) && successfulZoom >= 1 && successfulZoom <= 8) {
      try {
        window.localStorage.setItem("preco360.qr.successful-zoom.v1", String(successfulZoom));
      } catch {
        // Saving a preference is optional.
      }
    }
    stop();
    onResult(value);
  };

  const scanFrame = async (thorough = false, useExtraDecoders = false) => {
    const video = videoRef.current;
    if (
      !video ||
      video.readyState < 2 ||
      readingRef.current ||
      finishedRef.current
    ) {
      return;
    }

    readingRef.current = true;
    const session = scanSessionRef.current;
    if (useExtraDecoders) setStatus("reading");
    const now = performance.now();
    const deep = useExtraDecoders || (thorough &&
      now - scanStartedAtRef.current > 4800 &&
      now - lastDeepScanRef.current > 9000);
    if (deep) lastDeepScanRef.current = now;

    try {
      const value = await readQr(video, thorough, deep);
      if (session !== scanSessionRef.current || finishedRef.current) return;
      if (value) {
        finish(value);
      } else if (useExtraDecoders) {
        setMessage(zoomValueRef.current && zoomValueRef.current > 1
          ? "Ainda não li. Mantenha o QR inteiro, reto e nítido dentro do quadro."
          : "Ainda não li. Aproxime até o QR ocupar boa parte do quadro e mantenha a imagem nítida.");
        setStatus("scanning");
      }
    } catch {
      if (useExtraDecoders && session === scanSessionRef.current) {
        setMessage("Não consegui analisar esse quadro. Tente novamente.");
        setStatus("scanning");
      }
    } finally {
      readingRef.current = false;
    }
  };

  const requestCamera = async () => {
    const preferred: MediaStreamConstraints = {
      video: {
        facingMode: { exact: "environment" },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        aspectRatio: { ideal: 16 / 9 },
      },
      audio: false,
    };

    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        !["OverconstrainedError", "NotFoundError"].includes(error.name)
      ) {
        throw error;
      }

      return navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
    }
  };

  const optimizeCamera = async (track: MediaStreamTrack) => {
    const capabilities =
      track.getCapabilities?.() as ExtendedTrackCapabilities | undefined;

    torchSupportedRef.current = Boolean(capabilities?.torch);
    setTorchSupported(torchSupportedRef.current);

    // Foco e zoom são aplicados separadamente: um foco não suportado
    // não deve impedir o zoom de um QR impresso muito pequeno.
    if (capabilities?.focusMode?.includes("continuous")) {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      } catch {
        // Nem todo navegador Android aceita ajuste manual de foco.
      }
    }

    const zoom = capabilities?.zoom;
    if (!zoom || !Number.isFinite(zoom.min) || !Number.isFinite(zoom.max) || zoom.max <= zoom.min) {
      return;
    }

    const step = zoom.step && zoom.step > 0 ? zoom.step : 0.1;
    const range = { min: zoom.min, max: zoom.max, step };
    zoomRangeRef.current = range;
    setZoomRange(range);

    let remembered = 1.7;
    try {
      const previous = Number(window.localStorage.getItem("preco360.qr.successful-zoom.v1"));
      if (previous >= 1 && previous <= 8 && Number.isFinite(previous)) remembered = previous;
    } catch {
      // Camera works without storage.
    }
    const desired = Math.max(zoom.min, Math.min(zoom.max, remembered));
    const target = Math.min(zoom.max, Math.max(zoom.min,
      Math.round((desired - zoom.min) / step) * step + zoom.min,
    ));

    try {
      await track.applyConstraints({ advanced: [{ zoom: target }] });
      const applied = (track.getSettings() as ExtendedTrackSettings).zoom ?? target;
      zoomValueRef.current = applied;
      setZoomValue(applied);
    } catch {
      // Se o zoom programático for rejeitado, segue em 1× sem bloquear a leitura.
      setZoomRange(null);
      setZoomValue(null);
      zoomRangeRef.current = null;
      zoomValueRef.current = null;
    }
  };

  const adjustZoom = async (direction: -1 | 1) => {
    manualZoomRef.current = true;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !zoomRange || zoomValue === null || zoomUpdatingRef.current) return;

    const desired = Math.max(zoomRange.min, Math.min(zoomRange.max, zoomValue + direction * 0.5));
    const target = Math.max(zoomRange.min, Math.min(zoomRange.max,
      Math.round((desired - zoomRange.min) / zoomRange.step) * zoomRange.step + zoomRange.min,
    ));
    if (Math.abs(target - zoomValue) < 0.01) return;

    zoomUpdatingRef.current = true;
    try {
      await track.applyConstraints({ advanced: [{ zoom: target }] });
      const applied = (track.getSettings() as ExtendedTrackSettings).zoom ?? target;
      zoomValueRef.current = applied;
      setZoomValue(applied);
      setMessage("Mantenha o QR inteiro e nítido dentro do quadro.");
    } catch {
      setMessage("O navegador não permitiu alterar o zoom. Aproxime ou afaste o cupom.");
    } finally {
      zoomUpdatingRef.current = false;
    }
  };

  const checkCameraAssist = async () => {
    const stream = streamRef.current;
    const track = stream?.getVideoTracks()[0];
    const video = videoRef.current;
    if (!track || !video || video.readyState < 2 || assistBusyRef.current || finishedRef.current) return;
    const session = scanSessionRef.current;
    assistBusyRef.current = true;

    try {
      // Advance only after repeated unsuccessful scans; manual zoom wins.
      const range = zoomRangeRef.current;
      const current = zoomValueRef.current;
      const now = performance.now();
      if (
        !manualZoomRef.current && range && current !== null &&
        !zoomUpdatingRef.current &&
        now - scanStartedAtRef.current >= 3200 &&
        now - lastZoomStepRef.current >= 3400
      ) {
        const ceiling = Math.min(range.max, 3);
        const target = current < 2.15 ? 2.3 : current < 2.85 ? 3 : null;
        if (target !== null && current < ceiling - 0.05) {
          const desired = Math.min(target, ceiling);
          const quantized = Math.max(range.min, Math.min(range.max,
            Math.round((desired - range.min) / range.step) * range.step + range.min,
          ));
          lastZoomStepRef.current = now;
          zoomUpdatingRef.current = true;
          try {
            await track.applyConstraints({ advanced: [{ zoom: quantized }] });
            if (session !== scanSessionRef.current) return;
            const applied = (track.getSettings() as ExtendedTrackSettings).zoom ?? quantized;
            zoomValueRef.current = applied;
            setZoomValue(applied);
                  setMessage("Ajustando zoom automaticamente para encontrar um QR pequeno…");
          } catch {
            // The browser may report zoom support but reject changes at runtime.
            manualZoomRef.current = true;
          } finally {
            zoomUpdatingRef.current = false;
          }
        }
      }

      if (session !== scanSessionRef.current) return;
      // Sample a very small frame. Two consecutive dark samples avoid
      // reacting to brief shadows or the black modules of the QR code.
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 30;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lumaSum = 0;
      let darkCount = 0;
      const pixelCount = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        const brightness = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
        lumaSum += brightness;
        if (brightness < 75) darkCount += 1;
      }
      const isDim = lumaSum / pixelCount < 90 && darkCount / pixelCount > 0.5;
      lowLightSamplesRef.current = Math.max(-2, Math.min(2, lowLightSamplesRef.current + (isDim ? 1 : -1)));
      if (lowLightSamplesRef.current === 2) {
        setLowLightDetected(true);
        if (autoLightRef.current && torchSupportedRef.current && !torchOnRef.current && !manualTorchRef.current) {
          try {
            await track.applyConstraints({ advanced: [{ torch: true } as ExtendedTrackConstraintSet] });
            if (session !== scanSessionRef.current) return;
            torchOnRef.current = true;
            autoTorchOnRef.current = true;
            setTorchOn(true);
            setMessage("Pouca luz detectada: lanterna ativada automaticamente.");
          } catch {
            torchSupportedRef.current = false;
            setTorchSupported(false);
          }
        }
      } else if (lowLightSamplesRef.current === -2) {
        setLowLightDetected(false);
      }
    } catch {
      // Lighting samples and camera assist are best-effort only.
    } finally {
      assistBusyRef.current = false;
    }
  };

  const toggleAutoLight = () => {
    const next = !autoLightRef.current;
    autoLightRef.current = next;
    manualTorchRef.current = false;
    setAutoLightEnabled(next);
    try {
      window.localStorage.setItem("preco360.qr.auto-light.v1", next ? "1" : "0");
    } catch {
      // Persisting the user's choice is optional.
    }
    if (!next && autoTorchOnRef.current) {
      const track = streamRef.current?.getVideoTracks()[0];
      autoTorchOnRef.current = false;
      if (track) {
        const session = scanSessionRef.current;
        void track.applyConstraints({ advanced: [{ torch: false } as ExtendedTrackConstraintSet] })
          .then(() => {
            if (session !== scanSessionRef.current) return;
            torchOnRef.current = false;
            setTorchOn(false);
          })
          .catch(() => {
            // The manual light button remains available.
          });
      }
    }
    if (next && lowLightSamplesRef.current >= 2) void checkCameraAssist();
  };

  const start = async () => {
    const session = ++scanSessionRef.current;
    manualZoomRef.current = false;
    manualTorchRef.current = false;
    lowLightSamplesRef.current = 0;
    setLowLightDetected(false);
    setMessage("Abrindo câmera…");
    setStatus("starting");
    finishedRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("unsupported");
      }

      const stream = await requestCamera();
      if (session !== scanSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;

      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      if (session !== scanSessionRef.current) return;

      const track = stream.getVideoTracks()[0];
      if (track) await optimizeCamera(track);
      if (session !== scanSessionRef.current) return;
      scanStartedAtRef.current = performance.now();
      lastZoomStepRef.current = scanStartedAtRef.current;
      lastDeepScanRef.current = scanStartedAtRef.current;

      setMessage(
        "Centralize o QR e aproxime até ele ocupar boa parte do quadro",
      );
      setStatus("scanning");

      // Fast lightweight attempts keep the UI responsive.
      timerRef.current = window.setInterval(
        () => void scanFrame(false),
        350,
      );

      // A deeper pass tries tight crops + contrast/threshold variants.
      thoroughTimerRef.current = window.setInterval(
        () => void scanFrame(true),
        1400,
      );

      startupTimeoutRef.current = window.setTimeout(() => void scanFrame(true), 500);
      assistTimerRef.current = window.setInterval(() => {
        if (session === scanSessionRef.current) void checkCameraAssist();
      }, 1800);
    } catch (error) {
      if (session !== scanSessionRef.current) return;
      stop();
      const denied =
        error instanceof DOMException && error.name === "NotAllowedError";

      setMessage(
        denied
          ? "Permita o acesso à câmera ou use uma foto."
          : "Não foi possível abrir a câmera. Use uma foto do QR Code.",
      );
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;

    const next = !torchOnRef.current;
    manualTorchRef.current = true;
    autoTorchOnRef.current = false;

    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as ExtendedTrackConstraintSet],
      });
      torchOnRef.current = next;
      setTorchOn(next);
      setMessage(next ? "Lanterna ligada" : "Lanterna desligada");
    } catch {
      setTorchSupported(false);
      setMessage("A lanterna não está disponível neste navegador.");
    }
  };

  const readFile = async (file: File) => {
    setStatus("reading");
    setMessage("Lendo a foto…");

    const url = URL.createObjectURL(file);

    try {
      const image = new Image();
      image.src = url;
      await image.decode();

      const value = await readQr(image, true, true);

      if (value) {
        finish(value);
      } else {
        setStatus(streamRef.current ? "scanning" : "idle");
        setMessage(
          "QR não encontrado. Tire a foto mais perto, reta e sem reflexos.",
        );
      }
    } catch {
      setStatus(streamRef.current ? "scanning" : "idle");
      setMessage("Não foi possível abrir essa imagem.");
    } finally {
      URL.revokeObjectURL(url);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const active = status === "scanning" || status === "reading";

  return (
    <div className="space-y-2.5 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ScanLine className="h-4 w-4 text-primary" />
        Ler QR Code do cupom
      </div>

      <div className="flex flex-wrap gap-2">
        {active ? (
          <>
            <Button
              size="sm"
              onClick={() => void scanFrame(true, true)}
              disabled={status === "reading"}
            >
              <ScanLine className="mr-1.5 h-4 w-4" />
              Ler agora
            </Button>

            {torchSupported && (
              <Button
                size="sm"
                variant={torchOn ? "default" : "outline"}
                onClick={() => void toggleTorch()}
              >
                {torchOn ? (
                  <ZapOff className="mr-1.5 h-4 w-4" />
                ) : (
                  <Zap className="mr-1.5 h-4 w-4" />
                )}
                {torchOn ? "Desligar luz" : "Ligar luz"}
              </Button>
            )}

            {torchSupported && (
              <Button size="sm" type="button"
                variant={autoLightEnabled ? "secondary" : "outline"}
                onClick={toggleAutoLight}
                aria-pressed={autoLightEnabled}
                title="Quando autorizado, acende a lanterna se detectar pouca iluminação"
              >
                Luz auto {autoLightEnabled ? "✓" : ""}
              </Button>
            )}

            {zoomRange && zoomValue !== null && (
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" variant="outline" aria-label="Diminuir zoom"
                  onClick={() => void adjustZoom(-1)}
                  disabled={zoomValue <= zoomRange.min + 0.05}
                ><Minus className="h-4 w-4" /></Button>
                <span className="min-w-10 text-center text-xs font-semibold">{zoomValue.toFixed(1)}×</span>
                <Button type="button" size="sm" variant="outline" aria-label="Aumentar zoom"
                  onClick={() => void adjustZoom(1)}
                  disabled={zoomValue >= zoomRange.max - 0.05}
                ><Plus className="h-4 w-4" /></Button>
              </div>
            )}

            <Button size="sm" variant="outline" onClick={stop}>
              <CameraOff className="mr-1.5 h-4 w-4" />
              Parar
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => void start()}
            disabled={status === "starting"}
          >
            {status === "starting" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Camera className="mr-1.5 h-4 w-4" />
            )}
            Abrir câmera
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={status === "reading"}
        >
          <ImageIcon className="mr-1.5 h-4 w-4" />
          Usar foto
        </Button>

        {onClose && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              stop();
              onClose();
            }}
          >
            Fechar
          </Button>
        )}
      </div>

      {active && lowLightDetected && torchSupported && !torchOn && !autoLightEnabled && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs" role="status">
          <span>Pouca luz detectada. A lanterna pode ajudar.</span>
          <Button size="sm" type="button" variant="outline" onClick={toggleAutoLight}>
            Ativar luz auto
          </Button>
        </div>
      )}

      <div className={`relative overflow-hidden rounded-md bg-muted ${active ? "h-[220px] sm:h-[280px]" : "h-[160px] sm:h-[280px]"}`}>
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          autoPlay
          muted
          playsInline
        />

        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center text-sm text-muted-foreground">
            <Camera className="h-7 w-7" />
            {message}
          </div>
        )}

        {active && (
          <>
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[68%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-primary" />
            <div className="absolute inset-x-3 bottom-3 rounded bg-background/90 px-3 py-2 text-center text-xs">
              {status === "reading" && (
                <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
              )}
              {message}
            </div>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) void readFile(selected);
        }}
      />
    </div>
  );
}
