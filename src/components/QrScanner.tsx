import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Image as ImageIcon, Loader2, ScanLine, Zap, ZapOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QrScannerProps {
  onResult: (text: string) => void;
  onClose?: () => void;
}

type Status = "idle" | "starting" | "scanning" | "reading";
type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: unknown) => { data: string } | null;
type Source = HTMLVideoElement | HTMLImageElement;

let jsQrPromise: Promise<JsQr> | null = null;

const loadJsQr = () => {
  if (!jsQrPromise) jsQrPromise = import("jsqr").then((module) => (module.default ?? module) as unknown as JsQr);
  return jsQrPromise;
};

function getSourceSize(source: Source) {
  return source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.naturalWidth, height: source.naturalHeight };
}

function drawRegion(source: Source, maxSide: number, squareRatio?: number) {
  const { width: sourceWidth, height: sourceHeight } = getSourceSize(source);
  if (!sourceWidth || !sourceHeight) return null;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  // A prévia usa object-cover dentro de um quadrado. Em vídeo 16:9 isso significa que
  // o usuário vê apenas a região quadrada central. Escanear essa mesma região deixa o
  // QR muito maior para o decoder do que analisar o frame 16:9 inteiro.
  if (squareRatio) {
    const side = Math.min(sourceWidth, sourceHeight) * squareRatio;
    sw = side;
    sh = side;
    sx = (sourceWidth - side) / 2;
    sy = (sourceHeight - side) / 2;
  }

  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  return canvas;
}

async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  if ("BarcodeDetector" in window) {
    try {
      const Detector = (window as typeof window & {
        BarcodeDetector?: new (options: { formats: string[] }) => {
          detect: (image: HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>>;
        };
      }).BarcodeDetector;
      if (Detector) {
        const codes = await new Detector({ formats: ["qr_code"] }).detect(canvas);
        const value = codes[0]?.rawValue?.trim();
        if (value) return value;
      }
    } catch {
      // Alguns navegadores anunciam suporte, mas falham. O jsQR continua abaixo.
    }
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const jsQr = await loadJsQr();
  return jsQr(image.data, canvas.width, canvas.height, {
    inversionAttempts: "attemptBoth",
  })?.data?.trim() ?? null;
}

/** NFC-e usa QR denso. No vídeo priorizamos a região realmente visível no quadrado. */
async function readQr(source: Source, thorough = false): Promise<string | null> {
  const isVideo = source instanceof HTMLVideoElement;
  const attempts: Array<{ maxSide: number; squareRatio?: number }> = isVideo
    ? thorough
      ? [
          { maxSide: 1800, squareRatio: 0.68 },
          { maxSide: 1800, squareRatio: 1 },
          { maxSide: 1800 },
        ]
      : [{ maxSide: 1400, squareRatio: 1 }]
    : thorough
      ? [
          { maxSide: 1800 },
          { maxSide: 1800, squareRatio: 0.8 },
        ]
      : [{ maxSide: 1400 }];

  for (const attempt of attempts) {
    const canvas = drawRegion(source, attempt.maxSide, attempt.squareRatio);
    if (!canvas) continue;
    const value = await decodeCanvas(canvas);
    if (value) return value;
  }

  return null;
}

export function QrScanner({ onResult, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const readingRef = useRef(false);
  const finishedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("Aponte a câmera para o QR Code");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    readingRef.current = false;
    setStatus("idle");
    setTorchSupported(false);
    setTorchOn(false);
  };

  useEffect(() => () => stop(), []);

  const finish = (value: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stop();
    onResult(value);
  };

  const scanFrame = async (thorough = false) => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || readingRef.current || finishedRef.current) return;
    readingRef.current = true;
    if (thorough) setStatus("reading");
    try {
      const value = await readQr(video, thorough);
      if (value) finish(value);
      else if (thorough) {
        setMessage("Não consegui ler. Afaste um pouco, mantenha o QR nítido e evite reflexos.");
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
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (error) {
      if (!(error instanceof DOMException) || !["OverconstrainedError", "NotFoundError"].includes(error.name)) throw error;
      return navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    }
  };

  const start = async () => {
    setMessage("Abrindo câmera…");
    setStatus("starting");
    finishedRef.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
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
      const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & {
        torch?: boolean;
        focusMode?: string[];
      };
      setTorchSupported(Boolean(capabilities?.torch));

      if (capabilities?.focusMode?.includes("continuous")) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
          });
        } catch {
          // Autofoco contínuo não é obrigatório; seguimos com o padrão do aparelho.
        }
      }

      setMessage("Centralize o QR e deixe as bordas bem nítidas dentro do quadrado");
      setStatus("scanning");
      timerRef.current = window.setInterval(() => void scanFrame(false), 500);
      window.setTimeout(() => void scanFrame(true), 700);
    } catch (error) {
      stop();
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      setMessage(denied ? "Permita o acesso à câmera ou use uma foto." : "Não foi possível abrir a câmera. Use uma foto do QR Code.");
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
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
      const value = await readQr(image, true);
      if (value) finish(value);
      else {
        setStatus(streamRef.current ? "scanning" : "idle");
        setMessage("QR não encontrado. Tire a foto mais perto, reta e sem reflexos.");
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
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ScanLine className="h-4 w-4 text-primary" />
        Ler QR Code do cupom
      </div>
      <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
        <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <Camera className="h-7 w-7" />
            {message}
          </div>
        )}
        {active && (
          <>
            <div className="pointer-events-none absolute inset-[18%] rounded-md border-2 border-primary" />
            <div className="absolute inset-x-3 bottom-3 rounded bg-background/90 px-3 py-2 text-center text-xs">
              {status === "reading" && <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />}
              {message}
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {active ? (
          <>
            <Button size="sm" onClick={() => void scanFrame(true)} disabled={status === "reading"}>
              <ScanLine className="mr-1.5 h-4 w-4" />Ler agora
            </Button>
            {torchSupported && (
              <Button size="sm" variant={torchOn ? "default" : "outline"} onClick={() => void toggleTorch()}>
                {torchOn ? <ZapOff className="mr-1.5 h-4 w-4" /> : <Zap className="mr-1.5 h-4 w-4" />}
                {torchOn ? "Desligar luz" : "Ligar luz"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={stop}><CameraOff className="mr-1.5 h-4 w-4" />Parar</Button>
          </>
        ) : (
          <Button size="sm" onClick={() => void start()} disabled={status === "starting"}>
            {status === "starting" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            Abrir câmera
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={status === "reading"}>
          <ImageIcon className="mr-1.5 h-4 w-4" />Usar foto
        </Button>
        {onClose && <Button size="sm" variant="ghost" onClick={() => { stop(); onClose(); }}>Fechar</Button>}
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