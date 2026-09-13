import { ShieldAlert, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SefazBlockedNoticeProps {
  message: string;
  code: string;
  traceId?: string;
  onSendPhoto: () => void;
}

const TITLES: Record<string, string> = {
  CAPTCHA_REQUIRED: "A SEFAZ pediu verificação CAPTCHA",
  REDIRECTED: "O link foi redirecionado para uma página de erro",
  QR_FORMAT: "Formato de QR Code não aceito pela SEFAZ",
  NO_ITEMS: "Não conseguimos ler os produtos da página",
  JS_REQUIRED: "A página da SEFAZ só carrega o cupom no navegador",
};

export function SefazBlockedNotice({ message, code, traceId, onSendPhoto }: SefazBlockedNoticeProps) {
  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {TITLES[code] ?? "Não foi possível importar pelo link"}
          </p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>

      <div className="space-y-1.5 pl-7 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Como resolver em 3 passos:</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Abra o app da câmera e fotografe o cupom inteiro, bem iluminado e sem dobras.</li>
          <li>Toque no botão abaixo para ir para a aba de envio de foto/PDF.</li>
          <li>Envie a imagem — a IA lê os produtos e preços automaticamente.</li>
        </ol>
      </div>

      <Button onClick={onSendPhoto} className="w-full">
        <Camera className="mr-1.5 h-4 w-4" />
        Enviar foto do cupom
      </Button>

      {traceId && (
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          código de diagnóstico: {traceId}
        </p>
      )}
    </div>
  );
}
