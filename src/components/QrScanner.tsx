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
  const [zoomApplied, setZoomApplied] = useState(false);
  const [zoomRange, setZoomRange] = useState<CameraZoomRange | null>(null);
  const [zoomValue, setZoomValue] = useState<number | null>(null);
  const zoomUpdatingRef = useRef(false);

  const stop = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
    }
    if (thoroughTimerRef.current !== null) {
      window.clearInterval(thoroughTimerRef.current);
    }

    timerRef.current = null;
    thoroughTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;

    readingRef.current = false;
    setStatus("idle");
    setTorchSupported(false);
    setTorchOn(false);
    setZoomApplied(false);
    setZoomRange(null);
    setZoomValue(null);
    zoomUpdatingRef.current = false;
  };

  useEffect(() => () => stop(), []);

  const finish = (value: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
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
    if (thorough) setStatus("reading");

    try {
      const value = await readQr(video, thorough, useExtraDecoders);
      if (value) {
        finish(value);
      } else if (thorough) {
        setMessage(
          zoomApplied
            ? "Ainda não li. Mantenha o QR inteiro, reto e nítido dentro do quadro."
            : "Ainda não li. Aproxime até o QR ocupar boa parte do quadro e mantenha a imagem nítida.",
        );
        setStatus("scanning");
      }
    } catch {
      if (thorough) {
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

    setTorchSupported(Boolean(capabilities?.torch));

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
    setZoomRange({ min: zoom.min, max: zoom.max, step });

    const desired = Math.max(zoom.min, Math.min(zoom.max, 1.7));
    const target = Math.min(zoom.max, Math.max(zoom.min,
      Math.round((desired - zoom.min) / step) * step + zoom.min,
    ));

    try {
      await track.applyConstraints({ advanced: [{ zoom: target }] });
      const applied = (track.getSettings() as ExtendedTrackSettings).zoom ?? target;
      setZoomValue(applied);
      setZoomApplied(applied > 1.05);
    } catch {
      // Se o zoom programático for rejeitado, segue em 1× sem bloquear a leitura.
      setZoomRange(null);
      setZoomValue(null);
    }
  };

  const adjustZoom = async (direction: -1 | 1) => {
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
      setZoomValue(applied);
      setZoomApplied(applied > 1.05);
      setMessage("Mantenha o QR inteiro e nítido dentro do quadro.");
    } catch {
      setMessage("O navegador não permitiu alterar o zoom. Aproxime ou afaste o cupom.");
    } finally {
      zoomUpdatingRef.current = false;
    }
  };

  const start = async () => {
    setMessage("Abrindo câmera…");
    setStatus("starting");
    finishedRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("unsupported");
      }

      const stream = await requestCamera();
      const video = videoRef.current;

      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      const track = stream.getVideoTracks()[0];
      if (track) await optimizeCamera(track);

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

      window.setTimeout(() => void scanFrame(true), 500);
    } catch (error) {
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

    const next = !torchOn;

    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as ExtendedTrackConstraintSet],
      });
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
