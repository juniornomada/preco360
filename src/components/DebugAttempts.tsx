import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Trash2, Bug } from "lucide-react";
import { getAttempts, clearAttempts, type ImportAttempt } from "@/lib/importLog";
import { stepLabel } from "@/components/ImportProgress";

export function DebugAttempts() {
  const [attempts, setAttempts] = useState<ImportAttempt[]>([]);

  useEffect(() => {
    const refresh = () => setAttempts(getAttempts());
    refresh();
    window.addEventListener("import-attempts-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("import-attempts-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (attempts.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        <Bug className="mx-auto mb-2 h-5 w-5" />
        Nenhuma tentativa registrada ainda. Importe um cupom para ver o histórico aqui.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Últimas {attempts.length} tentativas (salvas apenas neste dispositivo).
        </p>
        <Button variant="ghost" size="sm" onClick={clearAttempts}>
          <Trash2 className="mr-1.5 h-4 w-4" />
          Limpar
        </Button>
      </div>

      {attempts.map((a, i) => {
        const ok = a.status === "success";
        return (
          <div
            key={`${a.traceId ?? "no-trace"}-${a.at}-${i}`}
            className={`space-y-2 rounded-lg border p-3 text-sm ${
              ok ? "border-primary/25 bg-primary/5" : "border-destructive/25 bg-destructive/5"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                {ok ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                {ok ? "Sucesso" : "Falha"}
                <Badge variant="secondary" className="font-normal">
                  {a.source === "file" ? "Foto/PDF" : a.source === "key" ? "Chave" : "URL"}
                </Badge>
              </div>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {new Date(a.at).toLocaleString("pt-BR")}
              </span>
            </div>

            {!ok && (
              <p className="text-xs">
                <span className="font-medium text-destructive">
                  Etapa que falhou: {stepLabel(a.source === "file" ? "file" : "url", a.step)}
                </span>
                {a.code ? ` · ${a.code}` : ""}
              </p>
            )}
            {a.message && <p className="text-xs text-muted-foreground">{a.message}</p>}

            {ok && (
              <p className="text-xs text-muted-foreground">
                {a.itemCount ?? 0} itens{a.supermarket ? ` · ${a.supermarket}` : ""}
              </p>
            )}

            {(a.blockType || (a.markers && a.markers.length > 0)) && (
              <div className="flex flex-wrap gap-1">
                {a.blockType && (
                  <Badge variant="destructive" className="text-[10px]">
                    {a.blockType === "captcha"
                      ? "CAPTCHA exigido"
                      : a.blockType === "redirect"
                      ? "Redirecionado"
                      : a.blockType === "js_required"
                      ? "Página exige navegador"
                      : "Bloqueio SEFAZ"}
                  </Badge>
                )}
                {a.markers?.map((m) => (
                  <Badge key={m} variant="outline" className="text-[10px]">
                    {m}
                  </Badge>
                ))}
              </div>
            )}

            {(a.requestedUrl || a.finalUrl) && (
              <div className="space-y-0.5 break-all rounded-md bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
                {a.requestedUrl && <p>solicitada: {a.requestedUrl}</p>}
                {a.finalUrl && a.finalUrl !== a.requestedUrl && <p>final: {a.finalUrl}</p>}
              </div>
            )}

            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              {a.traceId && <span>trace: {a.traceId}</span>}
              {typeof a.durationMs === "number" && <span>{a.durationMs} ms</span>}
              {typeof a.htmlLength === "number" && <span>html: {a.htmlLength} chars</span>}
              {a.wasRedirected != null && <span>redirect: {a.wasRedirected ? "sim" : "não"}</span>}
            </div>

          </div>
        );
      })}
    </div>
  );
}
