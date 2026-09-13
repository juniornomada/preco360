import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { QrScanner } from "@/components/QrScanner";
import { extractAccessKey, validateAccessKey, validateNfceUrl } from "@/lib/nfceKey";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Camera, CheckCircle2, ExternalLink, Key, Loader2, QrCode, ReceiptText, RefreshCw, Save, Trash2 } from "lucide-react";

type ParsedItem = { name: string; price: string };
type ImportSource = "qr" | "key";
type Diagnostics = {
  htmlLength?: number;
  lineCount?: number;
  titleItems?: number;
  codeItems?: number;
  tableItems?: number;
  lineItems?: number;
  marker?: string | null;
  classHints?: string[];
  finalHost?: string;
  finalPath?: string;
};
type BlockedState = {
  message: string;
  code: string;
  url?: string;
  traceId?: string;
  diagnostics?: Diagnostics;
};

const ufUrls: Record<string, string> = {
  "35": "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx",
  "33": "https://www.nfce.fazenda.rj.gov.br/consulta",
  "31": "https://nfce.fazenda.mg.gov.br/portalnfce/sistema/consultaarg.xhtml",
  "41": "https://www.nfce.pr.gov.br/nfce/qrcode",
  "43": "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
  "29": "https://nfe.sefaz.ba.gov.br/servicos/nfce/modulos/geral/NFCEC_consulta_chave_acesso.aspx",
  "26": "https://nfce.sefaz.pe.gov.br/nfce/consulta",
  "23": "https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html",
  "52": "https://nfe.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
  "50": "https://www.dfe.ms.gov.br/nfce/qrcode",
  "53": "https://dec.fazenda.df.gov.br/NFCE/qrcode",
};

function buildKeyUrl(key: string) {
  const base = ufUrls[key.slice(0, 2)] ?? "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx";
  const url = new URL(base);
  if (key.startsWith("35")) url.searchParams.set("chNFe", key);
  else if (url.hostname.includes("nfe.fazenda.gov.br")) {
    url.searchParams.set("tipoConsulta", "resumo");
    url.searchParams.set("nfe", key);
  } else url.searchParams.set("chNFe", key);
  return url.toString();
}

function blockedTitle(code: string) {
  if (code === "CAPTCHA_REQUIRED") return "A SEFAZ exige validação humana";
  if (code === "BLOCKED") return "A SEFAZ bloqueou a consulta automática";
  if (code === "NO_ITEMS") return "A página abriu, mas o layout ainda não foi reconhecido";
  if (code === "NOT_FOUND") return "Cupom não encontrado";
  if (code === "QR_FORMAT") return "Formato do QR Code rejeitado pela SEFAZ";
  return "A consulta precisa de ajuda";
}

export default function ReceiptImportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<ImportSource>("qr");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [supermarket, setSupermarket] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [source, setSource] = useState<ImportSource>("qr");
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  const [pageText, setPageText] = useState("");
  const [lastUrl, setLastUrl] = useState("");

  const keyCheck = useMemo(() => validateAccessKey(accessKey), [accessKey]);

  const clearResult = () => {
    setItems([]);
    setSupermarket("");
    setReceiptDate("");
    setBlocked(null);
    setPageText("");
  };

  const applyResult = (data: any, importSource: ImportSource) => {
    if (data?.error) {
      const state: BlockedState = {
        message: data.error,
        code: data.code || "UNKNOWN",
        url: data.finalUrl,
        traceId: data.traceId,
        diagnostics: data.diagnostics,
      };
      setBlocked(state);
      toast({
        title: blockedTitle(state.code),
        description: state.message,
        variant: state.code === "NO_ITEMS" ? "default" : "destructive",
      });
      return;
    }

    const parsed = Array.isArray(data?.items)
      ? data.items
          .map((item: any) => ({ name: String(item?.name ?? "").trim(), price: String(item?.price ?? "") }))
          .filter((item: ParsedItem) => item.name && Number(item.price.replace(",", ".")) > 0)
      : [];

    if (!parsed.length) {
      setBlocked({ message: "A consulta retornou sem produtos reconhecíveis.", code: "NO_ITEMS", diagnostics: data?.diagnostics, traceId: data?.traceId });
      toast({ title: "Nenhum item encontrado", description: "A página respondeu, mas o layout ainda não foi reconhecido." });
      return;
    }

    setItems(parsed);
    setSupermarket(data?.supermarket ?? "");
    setReceiptDate(data?.date ?? new Date().toISOString().slice(0, 10));
    setSource(importSource);
    setBlocked(null);
    toast({ title: `${parsed.length} itens encontrados`, description: "Revise os produtos antes de salvar." });
  };

  const importUrl = async (url: string, importSource: ImportSource) => {
    setLoading(true);
    clearResult();
    setLastUrl(url);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-receipt-url", { body: { url } });
      if (error) throw error;
      applyResult(data, importSource);
    } catch (error: any) {
      toast({ title: "Erro ao consultar cupom", description: error?.message ?? "Falha na consulta.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleQrResult = async (raw: string) => {
    setScannerOpen(false);
    const check = validateNfceUrl(raw);
    if (check.valid && check.url) {
      await importUrl(check.url, "qr");
      return;
    }
    const key = extractAccessKey(raw);
    if (key && validateAccessKey(key).valid) {
      setAccessKey(key);
      setTab("key");
      toast({ title: "Chave encontrada no QR Code", description: "O QR não trouxe uma URL consultável; tente importar pela chave." });
      return;
    }
    toast({ title: "QR Code não reconhecido", description: check.error ?? "Não encontrei uma NFC-e válida.", variant: "destructive" });
  };

  const importKey = async () => {
    if (!keyCheck.valid) return;
    await importUrl(buildKeyUrl(keyCheck.clean), "key");
  };

  const importPastedPage = async () => {
    if (pageText.trim().length < 80) return;
    setLoading(true);
    setItems([]);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-receipt-url", { body: { pageText } });
      if (error) throw error;
      applyResult(data, source);
    } catch (error: any) {
      toast({ title: "Não consegui ler o conteúdo", description: error?.message ?? "Revise o texto colado.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (index: number, field: keyof ParsedItem, value: string) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, [field]: value } : item));
  };

  const saveAll = async () => {
    if (!user || !items.length) return;
    setSaving(true);
    try {
      const date = receiptDate || new Date().toISOString().slice(0, 10);
      for (const item of items) {
        const name = item.name.trim();
        const price = Number(item.price.replace(",", "."));
        if (!name || !Number.isFinite(price) || price <= 0) continue;

        const { data: found, error: findError } = await supabase
          .from("products")
          .select("id")
          .eq("user_id", user.id)
          .ilike("name", name)
          .limit(1);
        if (findError) throw findError;

        let productId = found?.[0]?.id;
        if (!productId) {
          const { data: created, error: createError } = await supabase
            .from("products")
            .insert({ name, category: "Geral", user_id: user.id })
            .select("id")
            .single();
          if (createError) throw createError;
          productId = created.id;
        }

        const { error: priceError } = await supabase.from("prices").insert({
          product_id: productId,
          supermarket: supermarket.trim() || "Não informado",
          price,
          date,
          user_id: user.id,
          receipt_text: source === "qr" ? "Importado via QR Code NFC-e" : "Importado via chave NFC-e",
        });
        if (priceError) throw priceError;
      }
      toast({ title: "Cupom importado", description: `${items.length} preços foram adicionados ao seu histórico.` });
      clearResult();
      setAccessKey("");
    } catch (error: any) {
      toast({ title: "Erro ao salvar", description: error?.message ?? "Não foi possível salvar os preços.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const d = blocked?.diagnostics;

  return (
    <div className="page-container mx-auto w-full max-w-3xl">
      <div className="mb-5">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><ReceiptText className="h-5 w-5" /></div>
        <h1 className="text-2xl font-extrabold tracking-tight">Importar cupom fiscal</h1>
        <p className="mt-1 text-sm text-muted-foreground">Leia o QR Code da NFC-e ou informe a chave de 44 dígitos. Você revisa tudo antes de salvar.</p>
      </div>

      <Tabs value={tab} onValueChange={(value) => { clearResult(); setTab(value as ImportSource); }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="qr"><QrCode className="mr-2 h-4 w-4" />QR Code</TabsTrigger>
          <TabsTrigger value="key"><Key className="mr-2 h-4 w-4" />Chave de acesso</TabsTrigger>
        </TabsList>

        <TabsContent value="qr" className="mt-4 space-y-3">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Camera className="h-5 w-5" /></div>
                <div className="flex-1">
                  <p className="font-semibold">Aponte a câmera para o QR Code do cupom</p>
                  <p className="mt-1 text-sm text-muted-foreground">Quando o código for lido, a consulta começa automaticamente.</p>
                  <Button className="mt-4" onClick={() => setScannerOpen((open) => !open)} disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                    {scannerOpen ? "Fechar leitor" : "Ler QR Code"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          {scannerOpen && <QrScanner onResult={(value) => void handleQrResult(value)} onClose={() => setScannerOpen(false)} />}
        </TabsContent>

        <TabsContent value="key" className="mt-4 space-y-3">
          <Card>
            <CardContent className="space-y-3 p-5">
              <div>
                <p className="font-semibold">Chave de acesso da NFC-e</p>
                <p className="mt-1 text-sm text-muted-foreground">Cole os 44 dígitos impressos no cupom.</p>
              </div>
              <Input value={accessKey} onChange={(e) => setAccessKey(extractAccessKey(e.target.value) ?? e.target.value)} placeholder="44 dígitos da chave de acesso" className="font-mono" />
              {accessKey && !keyCheck.valid && <p className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{keyCheck.error}</p>}
              {keyCheck.valid && <p className="flex gap-2 text-sm text-primary"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Chave válida · {keyCheck.uf} · {keyCheck.emitted}</p>}
              <Button onClick={() => void importKey()} disabled={!keyCheck.valid || loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ReceiptText className="mr-2 h-4 w-4" />}
                Consultar cupom
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {blocked && (
        <Card className="mt-4 border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2"><CardTitle className="text-base">{blockedTitle(blocked.code)}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{blocked.message}</p>

            {blocked.code === "NO_ITEMS" && (
              <p className="text-sm text-muted-foreground">Não foi detectado CAPTCHA. A SEFAZ respondeu, mas o formato dessa página ainda não bateu com os padrões que o importador conhece.</p>
            )}
            {blocked.code === "CAPTCHA_REQUIRED" && (
              <p className="text-sm text-muted-foreground">Nesse caso a validação precisa ser feita por você na página oficial. Depois, copie o conteúdo já liberado para o campo abaixo.</p>
            )}

            <div className="flex flex-wrap gap-2">
              {blocked.url && (
                <Button variant="outline" onClick={() => window.open(blocked.url, "_blank", "noopener,noreferrer")}> <ExternalLink className="mr-2 h-4 w-4" />Abrir consulta oficial</Button>
              )}
              {lastUrl && (
                <Button variant="outline" disabled={loading} onClick={() => void importUrl(lastUrl, source)}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Tentar novamente
                </Button>
              )}
            </div>

            {d && (
              <div className="rounded-lg border bg-background/70 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Diagnóstico do importador</p>
                <p className="mt-1">Código: <span className="font-mono">{blocked.code}</span>{blocked.traceId ? <> · ref. <span className="font-mono">{blocked.traceId}</span></> : null}</p>
                <p>HTML: {d.htmlLength ?? 0} caracteres · {d.lineCount ?? 0} linhas</p>
                <p>Itens detectados: bloco {d.titleItems ?? 0} · código {d.codeItems ?? 0} · tabela {d.tableItems ?? 0} · texto {d.lineItems ?? 0}</p>
                {d.finalHost && <p>Portal: {d.finalHost}{d.finalPath}</p>}
                {d.classHints?.length ? <p className="mt-1 break-words">Classes: {d.classHints.slice(0, 10).join(", ")}</p> : null}
              </div>
            )}

            <div className="rounded-lg border bg-background p-3">
              <p className="mb-1 text-sm font-medium">Importação assistida</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Abra a consulta oficial. Se os produtos estiverem visíveis, selecione o conteúdo da página, copie e cole abaixo. Isso nos permite importar sem tentar contornar a proteção da SEFAZ.
              </p>
              <Textarea value={pageText} onChange={(e) => setPageText(e.target.value)} placeholder="Cole aqui o conteúdo da página da SEFAZ..." rows={6} />
              <Button className="mt-2" onClick={() => void importPastedPage()} disabled={loading || pageText.trim().length < 80}>Importar conteúdo da página</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {items.length > 0 && (
        <Card className="mt-5">
          <CardHeader><CardTitle className="text-base">Revise os itens ({items.length})</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Supermercado</label><Input value={supermarket} onChange={(e) => setSupermarket(e.target.value)} placeholder="Nome do supermercado" /></div>
              <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Data da compra</label><Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex gap-2 rounded-lg border p-2">
                  <Input value={item.name} onChange={(e) => updateItem(index, "name", e.target.value)} className="flex-1" />
                  <Input value={item.price} onChange={(e) => updateItem(index, "price", e.target.value)} className="w-24" inputMode="decimal" />
                  <Button variant="ghost" size="icon" onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={() => void saveAll()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar {items.length} preços no histórico
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
