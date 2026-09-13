import { useState } from "react";
import { ShieldAlert, ExternalLink, Copy, Check, Camera, Sparkles, Loader2, X, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { extractAccessKey } from "@/lib/nfceKey";

interface SefazCaptchaAssistProps {
  accessKey: string;
  /** URL da consulta pública da SEFAZ montada a partir da chave */
  sefazUrl: string;
  message: string;
  code: string;
  traceId?: string;
  importing?: boolean;
  /** Importa usando a URL final que o usuário copiou depois de resolver o CAPTCHA */
  onImportUrl: (url: string) => void;
  /** Importa a partir do texto da página já resolvida, colado pelo usuário */
  onImportText?: (pageText: string) => void;
  onSendPhoto: () => void;
}


const NATIONAL_PORTAL = "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=";

export function SefazCaptchaAssist({
  accessKey,
  sefazUrl,
  message,
  code,
  traceId,
  importing,
  onImportUrl,
  onImportText,
  onSendPhoto,
}: SefazCaptchaAssistProps) {
  const [copied, setCopied] = useState<"key" | "url" | null>(null);
  const [finalUrl, setFinalUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [autoImported, setAutoImported] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [pageText, setPageText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);

  const copy = async (value: string, what: "key" | "url") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard indisponível */
    }
  };

  /** Extrai uma URL válida de consulta a partir do texto colado */
  const extractUrl = (text: string): string | null => {
    const candidate = (text.match(/https?:\/\/\S+/i)?.[0] ?? text).trim();
    try {
      const u = new URL(candidate);
      if (!/^https?:$/.test(u.protocol)) return null;
      return u.toString();
    } catch {
      return null;
    }
  };

  const submit = (value: string) => {
    const url = extractUrl(value);
    if (!url) {
      setUrlError("Não reconheci uma URL válida. Copie o endereço completo da página do cupom (começa com https://).");
      return;
    }
    // aceita variações de query desde que a chave de 44 dígitos esteja na URL
    const hasKey = !!extractAccessKey(url);
    if (!hasKey && !/fazenda|sefaz|nfce|nfe/i.test(url)) {
      setUrlError("Essa URL não parece ser de uma consulta de NFC-e da SEFAZ. Confira o endereço copiado.");
      return;
    }
    setUrlError(null);
    setFinalUrl(url);
    onImportUrl(url);
  };


  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            A SEFAZ exige verificação (CAPTCHA) para consultar por chave
          </p>
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground">
            O CAPTCHA não pode ser exibido dentro do app (a SEFAZ bloqueia a incorporação da página).
            Resolva na página oficial e traga a URL de volta — leva alguns segundos.
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-md border bg-background/60 p-3">
        <p className="text-sm font-medium">1. Abra a consulta oficial e resolva o CAPTCHA</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={sefazUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              SEFAZ do estado
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={NATIONAL_PORTAL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Portal Nacional NFC-e
            </a>
          </Button>
        </div>

        <p className="text-sm font-medium pt-1">2. Cole a chave no campo da SEFAZ</p>
        <div className="flex gap-2">
          <Input readOnly value={accessKey} className="font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={() => copy(accessKey, "key")} aria-label="Copiar chave">
            {copied === "key" ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <p className="text-sm font-medium pt-1">3. Cole aqui a URL da página do cupom — importamos na hora</p>
        <div className="flex gap-2">
          <Input
            placeholder="https://www.nfce.fazenda... (URL após o CAPTCHA)"
            value={finalUrl}
            onChange={(e) => {
              setFinalUrl(e.target.value);
              setUrlError(null);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text.trim()) return;
              e.preventDefault();
              setFinalUrl(text.trim());
              setUrlError(null);
              setPendingUrl(text.trim());
            }}
            className="text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && finalUrl.trim()) {
                setPendingUrl(null);
                setAutoImported(false);
                submit(finalUrl);
              }
            }}
          />
          <Button
            size="sm"
            disabled={!finalUrl.trim() || importing}
            onClick={() => {
              setPendingUrl(null);
              setAutoImported(false);
              submit(finalUrl);
            }}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Importar
          </Button>
        </div>
        {pendingUrl && !importing && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-medium text-foreground">
              Confirmar importação desta URL?
            </p>
            <p className="break-all font-mono text-[11px] text-muted-foreground">{pendingUrl}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const url = pendingUrl;
                  setPendingUrl(null);
                  setAutoImported(true);
                  submit(url);
                }}
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                Importar agora
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPendingUrl(null);
                  setAutoImported(false);
                }}
              >
                <X className="mr-1.5 h-4 w-4" />
                Cancelar
              </Button>
            </div>
          </div>
        )}
        {urlError ? (
          <p className="text-xs text-destructive">{urlError}</p>
        ) : importing && autoImported ? (
          <p className="text-xs text-primary">Importando a URL confirmada...</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ao colar (Ctrl/Cmd+V) pedimos sua confirmação antes de iniciar a importação.
          </p>
        )}


      </div>

      {/* Alternativa que não depende da URL: colar o conteúdo da página */}
      <div className="space-y-2 rounded-md border bg-background/60 p-3">
        <p className="text-sm font-medium">
          Alternativa: cole o conteúdo da página (funciona mesmo quando a URL não abre)
        </p>
        <p className="text-xs text-muted-foreground">
          Na página do cupom já aberta, pressione Ctrl+A (selecionar tudo), Ctrl+C (copiar) e cole abaixo.
          A IA lê os produtos direto do texto, sem precisar da URL.
        </p>
        <Textarea
          placeholder="Cole aqui todo o texto da página do cupom..."
          value={pageText}
          onChange={(e) => {
            setPageText(e.target.value);
            setTextError(null);
          }}
          rows={4}
          className="text-xs"
        />
        {textError && <p className="text-xs text-destructive">{textError}</p>}
        <Button
          size="sm"
          className="w-full"
          disabled={!pageText.trim() || importing}
          onClick={() => {
            const value = pageText.trim();
            if (value.length < 200 || !/\d+[.,]\d{2}/.test(value)) {
              setTextError(
                "O texto colado parece incompleto (não encontramos preços). Selecione toda a página do cupom e copie novamente."
              );
              return;
            }
            setTextError(null);
            onImportText?.(value);
          }}
        >
          {importing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardPaste className="mr-1.5 h-4 w-4" />}
          Importar do texto colado
        </Button>
      </div>

      <Button variant="secondary" onClick={onSendPhoto} className="w-full">
        <Camera className="mr-1.5 h-4 w-4" />
        Preferir enviar a foto do cupom
      </Button>


      {traceId && (
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          código de diagnóstico: {traceId} · {code}
        </p>
      )}
    </div>
  );
}
