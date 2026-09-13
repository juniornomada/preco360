import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  decodeQrFromSource,
  type DecodeMethod,
  type DecodeMethodStatus,
  type DecodeStatusEvent,
} from "@/lib/qrDecode";
import { extractAccessKey } from "@/lib/nfceKey";

interface MethodTrace {
  method: DecodeMethod;
  status: DecodeMethodStatus;
  reason: string;
}

interface LabResult {
  id: string;
  fileName: string;
  kind: "image" | "pdf";
  /** Página do PDF (1 para imagens). */
  page: number;
  pages: number;
  thumbnail: string | null;
  state: "pending" | "running" | "success" | "failed" | "error";
  text: string | null;
  accessKey: string | null;
  method: DecodeMethod | null;
  durationMs: number | null;
  traces: MethodTrace[];
  errorMessage: string | null;
}

const statusLabels: Record<DecodeMethodStatus, string> = {
  running: "Em uso",
  success: "Sucesso",
  failed: "Falhou",
  unavailable: "Indisponível",
  skipped: "Não executado",
};

const statusTone: Record<DecodeMethodStatus, string> = {
  running: "bg-muted text-muted-foreground",
  success: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  unavailable: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
};

/** Converte um arquivo de imagem em elemento <img> decodificado. */
async function loadImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
  }
  return { img, url };
}

/** Renderiza todas as páginas de um PDF em canvases (escala alta para o QR). */
async function renderPdfPages(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const canvases: HTMLCanvasElement[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as any)!;
    await page.render({ canvasContext: ctx, viewport } as any).promise;
    canvases.push(canvas);
  }
  return canvases;
}

function thumbFromCanvas(canvas: HTMLCanvasElement) {
  const scale = Math.min(1, 240 / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  out.getContext("2d")!.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.7);
}

/**
 * Laboratório de leitura de QR Code.
 *
 * Permite enviar várias imagens/PDFs de uma vez e mostra, para cada arquivo
 * (e cada página de PDF), qual mecanismo conseguiu ler e o motivo exato da
 * falha de cada mecanismo quando a leitura não acontece.
 */
export default function QrLabPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<LabResult[]>([]);
  const [running, setRunning] = useState(false);

  const update = (id: string, patch: Partial<LabResult>) =>
    setResults((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const pushTrace = (id: string, event: DecodeStatusEvent) =>
    setResults((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const traces = item.traces.filter((t) => t.method !== event.method);
        return {
          ...item,
          traces: [...traces, { method: event.method, status: event.status, reason: event.reason }],
        };
      })
    );

  const runSource = async (
    id: string,
    source: HTMLImageElement | HTMLCanvasElement,
  ) => {
    update(id, { state: "running" });
    const started = performance.now();
    let succeeded: DecodeMethod | null = null;
    try {
      const text = await decodeQrFromSource(source, {
        fast: false,
        onStatus: (event) => {
          if (event.status === "success") succeeded = event.method;
          pushTrace(id, event);
        },
      });
      update(id, {
        state: text ? "success" : "failed",
        text,
        accessKey: text ? extractAccessKey(text) : null,
        method: succeeded,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (err: any) {
      update(id, {
        state: "error",
        errorMessage: err?.message ?? "Erro inesperado ao decodificar",
        durationMs: Math.round(performance.now() - started),
      });
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setRunning(true);
    try {
      for (const file of Array.from(files)) {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

        if (isPdf) {
          let canvases: HTMLCanvasElement[] = [];
          const baseId = `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          try {
            canvases = await renderPdfPages(file);
          } catch (err: any) {
            setResults((current) => [
              ...current,
              {
                id: baseId,
                fileName: file.name,
                kind: "pdf",
                page: 1,
                pages: 1,
                thumbnail: null,
                state: "error",
                text: null,
                accessKey: null,
                method: null,
                durationMs: null,
                traces: [],
                errorMessage: err?.message ?? "Não foi possível abrir o PDF",
              },
            ]);
            continue;
          }

          const entries = canvases.map((canvas, index) => ({
            id: `${baseId}-p${index + 1}`,
            canvas,
            entry: {
              id: `${baseId}-p${index + 1}`,
              fileName: file.name,
              kind: "pdf" as const,
              page: index + 1,
              pages: canvases.length,
              thumbnail: thumbFromCanvas(canvas),
              state: "pending" as const,
              text: null,
              accessKey: null,
              method: null,
              durationMs: null,
              traces: [],
              errorMessage: null,
            },
          }));
          setResults((current) => [...current, ...entries.map((e) => e.entry)]);
          for (const item of entries) {
            await runSource(item.id, item.canvas);
          }
          continue;
        }

        const id = `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        let loaded: { img: HTMLImageElement; url: string } | null = null;
        try {
          loaded = await loadImage(file);
        } catch {
          setResults((current) => [
            ...current,
            {
              id,
              fileName: file.name,
              kind: "image",
              page: 1,
              pages: 1,
              thumbnail: null,
              state: "error",
              text: null,
              accessKey: null,
              method: null,
              durationMs: null,
              traces: [],
              errorMessage: "Arquivo não é uma imagem válida para o navegador (ex.: HEIC).",
            },
          ]);
          continue;
        }

        setResults((current) => [
          ...current,
          {
            id,
            fileName: file.name,
            kind: "image",
            page: 1,
            pages: 1,
            thumbnail: loaded!.url,
            state: "pending",
            text: null,
            accessKey: null,
            method: null,
            durationMs: null,
            traces: [],
            errorMessage: null,
          },
        ]);
        await runSource(id, loaded.img);
      }
    } finally {
      setRunning(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const total = results.length;
  const ok = results.filter((r) => r.state === "success").length;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/upload">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Voltar
          </Link>
        </Button>
      </div>

      <h1 className="text-2xl font-bold">Laboratório de QR Code</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Envie várias imagens ou PDFs de cupom de uma vez. Para cada arquivo você vê qual mecanismo
        leu o QR e, quando falha, o motivo reportado por cada um deles.
      </p>

      <Card className="mt-4 p-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={running} onClick={() => inputRef.current?.click()}>
            {running ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            Enviar imagens/PDFs
          </Button>
          {total > 0 && (
            <>
              <Badge variant="secondary">
                {ok}/{total} lidos
              </Badge>
              <Button variant="ghost" size="sm" disabled={running} onClick={() => setResults([])}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Limpar
              </Button>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Cada página de PDF é testada separadamente, em esforço total (contraste, binarização
          adaptativa e rotações).
        </p>
      </Card>

      <div className="mt-4 space-y-3">
        {results.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum arquivo testado ainda.
          </p>
        )}

        {results.map((item) => (
          <Card key={item.id} className="overflow-hidden p-4">
            <div className="flex gap-3">
              {item.thumbnail ? (
                <img
                  src={item.thumbnail}
                  alt={`Pré-visualização de ${item.fileName}`}
                  className="h-20 w-20 shrink-0 rounded-md border object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <AlertCircle className="h-5 w-5 text-muted-foreground" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {item.kind === "pdf" ? (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <p className="truncate text-sm font-medium">{item.fileName}</p>
                  {item.pages > 1 && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      pág. {item.page}/{item.pages}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {item.state === "running" && (
                    <Badge variant="secondary">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      Decodificando
                    </Badge>
                  )}
                  {item.state === "success" && (
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Lido por {item.method ?? "—"}
                    </Badge>
                  )}
                  {item.state === "failed" && <Badge variant="destructive">Não foi lido</Badge>}
                  {item.state === "error" && <Badge variant="destructive">Erro no arquivo</Badge>}
                  {item.durationMs !== null && (
                    <span className="text-[11px] text-muted-foreground">{item.durationMs} ms</span>
                  )}
                </div>

                {item.errorMessage && (
                  <p className="mt-1.5 text-xs text-destructive">{item.errorMessage}</p>
                )}

                {item.text && (
                  <div className="mt-2 space-y-1">
                    <p className="break-all rounded-md bg-muted p-2 text-[11px] leading-4">
                      {item.text}
                    </p>
                    {item.accessKey && (
                      <p className="text-[11px] text-muted-foreground">
                        Chave detectada: <span className="font-mono">{item.accessKey}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {item.traces.length > 0 && (
              <div className="mt-3 grid gap-1.5 border-t pt-3">
                {item.traces.map((trace) => (
                  <div key={trace.method} className="flex items-start gap-2">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${statusTone[trace.status]}`}
                    >
                      {statusLabels[trace.status]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{trace.method}</p>
                      <p className="break-words text-[11px] leading-4 text-muted-foreground">
                        {trace.reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </main>
  );
}
