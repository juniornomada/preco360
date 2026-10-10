import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ReceiptText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { validateAccessKey } from "@/lib/nfceKey";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Status = "loading" | "ready" | "submitting" | "done" | "error";

const CHANNEL_NAME = "preco360-receipt-import";

function sendResult(message: unknown) {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(message);
    channel.close();
  } catch {
    // BroadcastChannel pode não existir em navegadores antigos.
  }

  try {
    window.opener?.postMessage(message, window.location.origin);
  } catch {
    // A aba principal pode não manter window.opener em alguns navegadores móveis.
  }

  try {
    localStorage.setItem(
      "preco360.receipt.import-result",
      JSON.stringify({ message, sentAt: Date.now() }),
    );
  } catch {
    // Fallback opcional; não impede o envio pelos outros canais.
  }
}

export default function SefazSpNfcePage() {
  const key = useMemo(
    () => new URLSearchParams(window.location.search).get("key")?.replace(/\D/g, "") ?? "",
    [],
  );
  const keyCheck = useMemo(() => validateAccessKey(key), [key]);
  const supported =
    keyCheck.valid && keyCheck.model === "65" && key.startsWith("35");

  const [status, setStatus] = useState<Status>("loading");
  const [captchaImage, setCaptchaImage] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [message, setMessage] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const finishedRef = useRef(false);

  const finishWithHtml = async (html: string) => {
    const parsed = await supabase.functions.invoke("fetch-receipt-url", {
      body: { pageText: html },
    });
    if (parsed.error) throw parsed.error;
    if (
      parsed.data?.error ||
      !Array.isArray(parsed.data?.items) ||
      !parsed.data.items.length
    ) {
      throw new Error(
        parsed.data?.error ??
          "A nota abriu, mas não consegui identificar os produtos.",
      );
    }

    const resultMessage = {
      type: "preco360:receipt-import",
      resultId: crypto.randomUUID(),
      key,
      payload: parsed.data,
    };

    sendResult(resultMessage);
    finishedRef.current = true;
    setStatus("done");
    setMessage(
      `${parsed.data.items.length} itens enviados para o Preço 360. Esta aba pode ser fechada.`,
    );

    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // Se o navegador não permitir fechar, o usuário verá a confirmação.
      }
    }, 900);
  };

  const startSession = async () => {
    if (!supported) return;

    finishedRef.current = false;
    socketRef.current?.close();
    socketRef.current = null;
    setStatus("loading");
    setMessage("");
    setCaptcha("");
    setCaptchaImage("");

    try {
      const { data, error } = await supabase.functions.invoke(
        "sefaz-sp-nfce-session",
        { body: { action: "ticket" } },
      );
      if (error) throw error;
      if (!data?.ticket) {
        throw new Error(data?.message || "Não consegui criar a sessão da SEFAZ-SP.");
      }

      const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || "");
      if (!baseUrl) throw new Error("Configuração do servidor indisponível.");
      const wsUrl =
        baseUrl.replace(/^http/i, "ws") +
        "/functions/v1/sefaz-sp-nfce-live?ticket=" +
        encodeURIComponent(String(data.ticket));

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        void (async () => {
          try {
            const payload = JSON.parse(String(event.data || "{}"));

            if (payload?.type === "captcha") {
              setCaptchaImage(String(payload.captcha_image || ""));
              setCaptcha("");
              setMessage(String(payload.message || ""));
              setStatus("ready");
              return;
            }

            if (payload?.type === "retry") {
              setMessage(
                String(
                  payload.message ||
                    "A SEFAZ não aceitou a consulta. Tente novamente.",
                ),
              );
              setStatus("ready");
              return;
            }

            if (payload?.type === "result" && payload?.html) {
              setStatus("submitting");
              setMessage("NFC-e encontrada. Importando os itens…");
              await finishWithHtml(String(payload.html));
              socket.close();
              return;
            }

            if (payload?.type === "error") {
              setStatus("error");
              setMessage(
                String(payload.message || "A sessão da SEFAZ-SP apresentou erro."),
              );
            }
          } catch (error: any) {
            setStatus("error");
            setMessage(
              error?.message ?? "Não foi possível processar a resposta da SEFAZ-SP.",
            );
          }
        })();
      };

      socket.onerror = () => {
        if (finishedRef.current) return;
        setStatus("error");
        setMessage(
          "A conexão contínua com a SEFAZ-SP foi interrompida. Tente novamente.",
        );
      };

      socket.onclose = () => {
        if (finishedRef.current) return;
        socketRef.current = null;
      };
    } catch (error: any) {
      setStatus("error");
      setMessage(
        error?.message ?? "Não foi possível iniciar a consulta na SEFAZ-SP.",
      );
    }
  };

  useEffect(() => {
    if (!supported) {
      setStatus("error");
      setMessage("Esta tela aceita somente NFC-e modelo 65 emitida em São Paulo.");
      return;
    }
    void startSession();

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  const submit = async () => {
    if (!captcha.trim() || status === "submitting") return;

    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setStatus("error");
      setMessage("A sessão expirou. Gere um novo CAPTCHA.");
      return;
    }

    setStatus("submitting");
    setMessage("Validando na SEFAZ-SP…");

    socket.send(
      JSON.stringify({
        type: "submit",
        key,
        captcha: captcha.trim(),
      }),
    );
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto w-full max-w-md pt-4">
        <div className="mb-5">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ReceiptText className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-extrabold">Validar NFC-e na SEFAZ-SP</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A aba principal do Preço 360 continua aberta. Esta tela mantém uma sessão contínua com a SEFAZ-SP enquanto você lê e digita o CAPTCHA.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div>
              <p className="text-xs text-muted-foreground">Chave de acesso</p>
              <p className="mt-1 break-all font-mono text-xs">{key}</p>
            </div>

            {status === "loading" && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Abrindo sessão segura com a SEFAZ-SP…
              </div>
            )}

            {(status === "ready" || status === "submitting") && (
              <>
                <div>
                  <p className="mb-2 text-sm font-semibold">
                    Digite os caracteres da imagem
                  </p>
                  <div className="flex min-h-24 items-center justify-center rounded-lg border bg-white p-3">
                    {captchaImage ? (
                      <img
                        src={captchaImage}
                        alt="CAPTCHA da SEFAZ-SP"
                        className="max-h-24 max-w-full object-contain"
                      />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">
                    Digite o CAPTCHA aqui
                  </p>
                  <Input
                  value={captcha}
                  onChange={(event) => setCaptcha(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submit();
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="h-14 border-2 border-primary/60 bg-primary/5 text-center font-mono text-xl font-bold uppercase tracking-[0.3em] shadow-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                  placeholder="CAPTCHA"
                  disabled={status === "submitting"}
                />
                </div>

                {message && (
                  <p className="text-sm text-destructive">{message}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void startSession()}
                    disabled={status === "submitting"}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Nova imagem
                  </Button>
                  <Button
                    onClick={() => void submit()}
                    disabled={!captcha.trim() || status === "submitting"}
                  >
                    {status === "submitting" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Consultar
                  </Button>
                </div>
              </>
            )}

            {status === "done" && (
              <div className="rounded-lg border bg-primary/5 p-4">
                <p className="flex items-center gap-2 font-semibold text-primary">
                  <CheckCircle2 className="h-5 w-5" />
                  NFC-e capturada
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{message}</p>
                <Button className="mt-4 w-full" onClick={() => window.close()}>
                  Fechar e voltar ao Preço 360
                </Button>
              </div>
            )}

            {status === "error" && (
              <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
                <p className="text-sm text-destructive">{message}</p>
                {supported && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void startSession()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Tentar novamente
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
