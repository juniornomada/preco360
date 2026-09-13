import { useEffect, useState } from "react";
import { Loader2, Check, Globe, Brain, ListChecks, FileText, ScanSearch, QrCode, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface Step {
  id: string;
  label: string;
  icon: React.ReactNode;
  duration: number; // estimated ms
}

const URL_STEPS: Step[] = [
  { id: "decode", label: "Decodificando QR / chave de acesso...", icon: <QrCode className="h-4 w-4" />, duration: 800 },
  { id: "fetch", label: "Consultando a página da SEFAZ...", icon: <Globe className="h-4 w-4" />, duration: 3000 },
  { id: "ai", label: "Analisando cupom com IA...", icon: <Brain className="h-4 w-4" />, duration: 8000 },
  { id: "items", label: "Extraindo produtos e preços...", icon: <ListChecks className="h-4 w-4" />, duration: 2000 },
];

const FILE_STEPS: Step[] = [
  { id: "decode", label: "Lendo arquivo...", icon: <FileText className="h-4 w-4" />, duration: 1000 },
  { id: "fetch", label: "Executando OCR na imagem...", icon: <ScanSearch className="h-4 w-4" />, duration: 5000 },
  { id: "ai", label: "Analisando com IA...", icon: <Brain className="h-4 w-4" />, duration: 8000 },
  { id: "items", label: "Extraindo produtos e preços...", icon: <ListChecks className="h-4 w-4" />, duration: 2000 },
];

/** Mapeia o código de erro da edge function para a etapa onde a falha ocorreu */
export function stepFromErrorCode(code?: string): string {
  switch (code) {
    case "MISSING_URL":
    case "INVALID_URL":
    case "QR_FORMAT":
    case "INVALID_KEY":
      return "decode";
    case "BLOCKED":
    case "NOT_FOUND":
    case "HTTP_ERROR":
    case "SEFAZ_DOWN":
    case "REDIRECTED":
    case "CAPTCHA_REQUIRED":
    case "JS_REQUIRED":
      return "fetch";
    case "AI_ERROR":
    case "AI_RATE_LIMIT":
    case "AI_NO_CREDITS":
    case "AI_PARSE_ERROR":
      return "ai";
    case "NO_ITEMS":
      return "items";
    default:
      return "ai";
  }
}

/** Rótulo legível de uma etapa, usado também na aba de depuração */
export function stepLabel(mode: "url" | "file", stepId?: string): string {
  const steps = mode === "url" ? URL_STEPS : FILE_STEPS;
  return steps.find((s) => s.id === stepId)?.label ?? "Etapa desconhecida";
}

interface ImportProgressProps {
  active: boolean;
  mode: "url" | "file";
  /** Falha ocorrida: destaca exatamente a etapa que quebrou */
  failure?: { code?: string; message: string } | null;
}

export function ImportProgress({ active, mode, failure }: ImportProgressProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const steps = mode === "url" ? URL_STEPS : FILE_STEPS;

  useEffect(() => {
    if (!active) {
      setCurrentStep(0);
      setProgress(0);
      return;
    }

    const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0);
    let elapsed = 0;
    let stepIndex = 0;

    const interval = setInterval(() => {
      elapsed += 200;

      // Calculate overall progress (cap at 95% since we don't know when it'll finish)
      const rawProgress = Math.min((elapsed / totalDuration) * 100, 95);
      setProgress(rawProgress);

      // Determine current step
      let accumulated = 0;
      for (let i = 0; i < steps.length; i++) {
        accumulated += steps[i].duration;
        if (elapsed < accumulated) {
          stepIndex = i;
          break;
        }
        if (i === steps.length - 1) stepIndex = i;
      }
      setCurrentStep(stepIndex);
    }, 200);

    return () => clearInterval(interval);
  }, [active, mode]);

  const failedIndex = failure
    ? Math.max(0, steps.findIndex((s) => s.id === stepFromErrorCode(failure.code)))
    : -1;

  if (!active && failedIndex < 0) return null;

  const showingFailure = !active && failedIndex >= 0;

  return (
    <div
      className={`my-4 space-y-3 rounded-lg border p-4 ${
        showingFailure ? "border-destructive/30 bg-destructive/5" : "bg-muted/30"
      }`}
    >
      <Progress
        value={showingFailure ? ((failedIndex + 1) / steps.length) * 100 : progress}
        className="h-2"
      />
      <div className="space-y-2">
        {steps.map((step, i) => {
          const isFailed = showingFailure && i === failedIndex;
          const isSkipped = showingFailure && i > failedIndex;
          const isDone = showingFailure ? i < failedIndex : i < currentStep;
          const isActive = !showingFailure && i === currentStep;
          return (
            <div key={step.id} className="space-y-1">
              <div
                className={`flex items-center gap-2.5 text-sm transition-opacity duration-300 ${
                  isFailed
                    ? "font-semibold text-destructive"
                    : isSkipped
                      ? "text-muted-foreground opacity-30 line-through"
                      : isDone
                        ? "text-primary opacity-70"
                        : isActive
                          ? "font-medium text-foreground"
                          : "text-muted-foreground opacity-40"
                }`}
              >
                {isFailed ? (
                  <X className="h-4 w-4 text-destructive" />
                ) : isDone ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center">{step.icon}</span>
                )}
                {step.label}
              </div>
              {isFailed && failure?.message && (
                <p className="pl-6 text-xs text-destructive/90">
                  Falhou aqui: {failure.message}
                  {failure.code ? ` (${failure.code})` : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
