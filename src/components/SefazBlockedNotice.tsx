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
  BLOCKED: "A SEFAZ bloqueou a consulta automática",
  REDIRECTED: "O link foi redirecionado para uma página de erro",
  QR_FORMAT: "A SEFAZ rejeitou o formato do QR Code",
  NOT_FOUND: "Cupom não encontrado pela SEFAZ",
  NO_ITEMS: "A consulta abriu, mas os produtos não foram identificados",
  JS_REQUIRED: "A página da SEFAZ só carrega o cupom no navegador",
};

const DESCRIPTIONS: Record<string, string> = {
  NO_ITEMS: "Isso não significa necessariamente CAPTCHA. O portal respondeu, mas esse layout ainda não foi reconhecido automaticamente.",
  CAPTCHA_REQUIRED: "A consulta chegou ao portal, mas a SEFAZ exige uma validação humana antes de mostrar os dados.",
  BLOCKED: "O portal recusou a consulta feita pelo servidor. Você ainda pode importar usando a consulta oficial ou uma foto do cupom.",
};

export function SefazBlockedNotice({ message, code, traceId, onSendPhoto }: SefazBlockedNoticeProps) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {TITLES[code] ?? "Não foi possível importar automaticamente"}
          </p>
          <p className="text-sm text-muted-foreground">{message}</p>
          {DESCRIPTIONS[code] && <p className="text-xs text-muted-foreground">{DESCRIPTIONS[code]}</p>}
        </div>
      </div>

      <Button onClick={onSendPhoto} variant="outline" className="w-full">
        <Camera className="mr-1.5 h-4 w-4" />
        Usar foto do cupom como alternativa
      </Button>

      {traceId && (
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          código de diagnóstico: {traceId} · {code}
        </p>
      )}
    </div>
  );
}
