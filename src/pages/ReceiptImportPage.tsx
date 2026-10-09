import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { QrScanner } from "@/components/QrScanner";
import { extractAccessKey, validateAccessKey, validateNfceUrl } from "@/lib/nfceKey";
import { inferPackage } from "@/lib/flyerAnalysis";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Camera, CheckCircle2, ExternalLink, Key, Loader2, QrCode, ReceiptText, RefreshCw, Save, Trash2, Upload } from "lucide-react";

const db = supabase as any;

type ParsedItem = {
  name: string;
  price: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  totalPrice?: string;
};
type ImportSource = "qr" | "key" | "image";
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

function decimalValue(value?: string | null) {
  if (!value) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function brl(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function isReceiptCapacitySpecification(item: ParsedItem) {
  const text = item.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return /^(sc|saco) lixo\b|^(caixa organizadora|caixa termica|garrafa termica|mop\b|panela|frigideira|jarra|lixeira|balde|pote organizador)\b/.test(
    text,
  );
}

function normalizedReceiptPrice(item: ParsedItem) {
  const price = decimalValue(item.unitPrice ?? item.price);
  if (!price) return null;

  const saleUnit = String(item.unit ?? "").toUpperCase();
  if (saleUnit === "KG") return { value: price, unit: "kg" };
  if (saleUnit === "L") return { value: price, unit: "L" };
  if (saleUnit === "G") return { value: price * 1000, unit: "kg" };
  if (saleUnit === "ML") return { value: price * 1000, unit: "L" };

  if (isReceiptCapacitySpecification(item)) return null;

  const pkg = inferPackage(item.name);
  if (!pkg || pkg.baseQuantity <= 0) return null;
  return {
    value: price / pkg.baseQuantity,
    unit: pkg.baseUnit === "kg" ? "kg" : pkg.baseUnit === "l" ? "L" : "un",
  };
}

function packageMetadata(item: ParsedItem) {
  const saleUnit = String(item.unit ?? "").toUpperCase();
  if (saleUnit === "KG") return { package_size: 1, unit: "kg" };
  if (saleUnit === "L") return { package_size: 1, unit: "l" };
  if (saleUnit === "G") return { package_size: 1, unit: "g" };
  if (saleUnit === "ML") return { package_size: 1, unit: "ml" };

  if (isReceiptCapacitySpecification(item)) return null;

  const pkg = inferPackage(item.name);
  return pkg ? { package_size: pkg.quantity, unit: pkg.unit } : null;
}

function normalizedPriceFromPackage(
  price: number,
  metadata:
    | { package_size: number | string; unit: string }
    | null
    | undefined,
) {
  if (!Number.isFinite(price) || price <= 0 || !metadata) return null;

  const size = Number(metadata.package_size);
  const unit = String(metadata.unit ?? "").toLowerCase();
  if (!Number.isFinite(size) || size <= 0) return null;

  if (unit === "g") return { value: price / (size / 1000), unit: "kg" as const };
  if (unit === "kg") return { value: price / size, unit: "kg" as const };
  if (unit === "ml") return { value: price / (size / 1000), unit: "L" as const };
  if (unit === "l") return { value: price / size, unit: "L" as const };
  if (["un", "und", "unid"].includes(unit)) {
    return { value: price / size, unit: "un" as const };
  }

  return null;
}

function receiptItemSummary(item: ParsedItem) {
  const quantity = decimalValue(item.quantity);
  const unitPrice = decimalValue(item.unitPrice ?? item.price);
  const total = decimalValue(item.totalPrice);
  const normalized = normalizedReceiptPrice(item);
  const unit = String(item.unit ?? "").toUpperCase();

  const parts: string[] = [];
  if (quantity && unit && unitPrice) {
    parts.push(
      `${quantity.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${unit.toLowerCase()} × ${brl(unitPrice)}`,
    );
  }
  if (total) parts.push(`total ${brl(total)}`);
  if (normalized) parts.push(`${brl(normalized.value)}/${normalized.unit}`);

  return [...new Set(parts)].join(" · ");
}

function receiptItemKey(item: ParsedItem) {
  return [
    item.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    item.quantity ?? "",
    item.unitPrice ?? item.price ?? "",
    item.totalPrice ?? "",
  ].join("|");
}

function mergeReceiptPageItems(current: ParsedItem[], next: ParsedItem[]) {
  if (!current.length) return [...next];
  if (!next.length) return current;

  const maxOverlap = Math.min(8, current.length, next.length);
  let overlap = 0;

  for (let size = maxOverlap; size >= 1; size -= 1) {
    const currentTail = current.slice(-size).map(receiptItemKey);
    const nextHead = next.slice(0, size).map(receiptItemKey);
    if (currentTail.every((key, index) => key === nextHead[index])) {
      overlap = size;
      break;
    }
  }

  return [...current, ...next.slice(overlap)];
}

async function loadImageBitmap(file: File) {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(file);
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
      element.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function canvasBlob(canvas: HTMLCanvasElement, type: string) {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao preparar a imagem."))),
      type,
      type === "image/jpeg" ? 0.94 : undefined,
    );
  });
}

async function splitLongReceiptImage(file: File) {
  const image = await loadImageBitmap(file);
  const width = image.width;
  const height = image.height;

  if (!width || !height) return [file];

  // Screenshots fiscais muito compridos perdem legibilidade quando enviados inteiros
  // ao modelo de visão. Mantemos uma proporção próxima à tela do celular.
  if (height / width <= 3.2) return [file];

  const sourceSliceHeight = Math.max(320, Math.round(width * 2.55));
  const sourceOverlap = Math.max(48, Math.round(width * 0.28));
  const targetWidth = Math.min(1600, Math.max(1000, width));
  const scale = targetWidth / width;
  const slices: File[] = [];

  let top = 0;
  let index = 0;
  while (top < height && slices.length < 24) {
    const cropHeight = Math.min(sourceSliceHeight, height - top);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round(cropHeight * scale));

    const context = canvas.getContext("2d");
    if (!context) throw new Error("O navegador não conseguiu preparar o print.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      0,
      top,
      width,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const blob = await canvasBlob(canvas, "image/png");
    const base = file.name.replace(/\.[^.]+$/, "") || "nota";
    slices.push(
      new File(
        [blob],
        `${base}-parte-${String(index + 1).padStart(2, "0")}.png`,
        { type: "image/png" },
      ),
    );

    if (top + cropHeight >= height) break;
    top += Math.max(1, sourceSliceHeight - sourceOverlap);
    index += 1;
  }

  return slices.length ? slices : [file];
}

async function edgeFunctionErrorMessage(error: any) {
  try {
    const response = error?.context;
    if (response && typeof response.clone === "function") {
      const payload = await response.clone().json();
      const message = payload?.message || payload?.error;
      if (message) return String(message);
    }
  } catch {
    // Fall back to the SDK error below.
  }
  return String(error?.message || "Falha ao analisar a imagem.");
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
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageProgress, setImageProgress] = useState("");

  const keyCheck = useMemo(() => validateAccessKey(accessKey), [accessKey]);

  const clearResult = () => {
    setItems([]);
    setSupermarket("");
    setReceiptDate("");
    setBlocked(null);
    setPageText("");
    setImageProgress("");
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
          .map((item: any) => ({
            name: String(item?.name ?? "").trim(),
            price: String(item?.price ?? ""),
            quantity: item?.quantity ? String(item.quantity) : undefined,
            unit: item?.unit ? String(item.unit) : undefined,
            unitPrice: item?.unitPrice ? String(item.unitPrice) : undefined,
            totalPrice: item?.totalPrice ? String(item.totalPrice) : undefined,
          }))
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


  const normalizeImageItems = (data: any) =>
    (Array.isArray(data?.items) ? data.items : [])
      .map((item: any) => ({
        name: String(item?.name ?? "").trim(),
        price: String(item?.price ?? item?.unitPrice ?? item?.totalPrice ?? ""),
        quantity: item?.quantity ? String(item.quantity) : undefined,
        unit: item?.unit ? String(item.unit) : undefined,
        unitPrice: item?.unitPrice ? String(item.unitPrice) : undefined,
        totalPrice: item?.totalPrice ? String(item.totalPrice) : undefined,
      }))
      .filter(
        (item: ParsedItem) =>
          item.name && Number(String(item.price).replace(",", ".")) > 0,
      );

  const importReceiptImages = async () => {
    if (!imageFiles.length) return;
    const originals = [...imageFiles];
    setLoading(true);
    clearResult();
    setSource("image");

    let merged: ParsedItem[] = [];
    let detectedSupermarket = "";
    let detectedDate = "";
    const failures: string[] = [];

    try {
      setImageProgress("Preparando o(s) print(s)…");
      const preparedGroups: File[][] = [];
      for (const original of originals) {
        preparedGroups.push(await splitLongReceiptImage(original));
      }
      const totalParts = preparedGroups.reduce((sum, group) => sum + group.length, 0);
      let partNumber = 0;

      for (const group of preparedGroups) {
        let groupItems: ParsedItem[] = [];

        for (const file of group) {
          partNumber += 1;
          setImageProgress(
            totalParts > originals.length
              ? `Lendo trecho ${partNumber} de ${totalParts}…`
              : `Lendo imagem ${partNumber} de ${totalParts}…`,
          );

          const formData = new FormData();
          formData.append("file", file);

          const { data, error } = await supabase.functions.invoke(
            "analyze-receipt-image",
            { body: formData },
          );

          if (error) {
            failures.push(
              `${file.name}: ${await edgeFunctionErrorMessage(error)}`,
            );
            continue;
          }

          const parsed = normalizeImageItems(data);
          if (!parsed.length) {
            failures.push(`${file.name}: nenhum item legível encontrado`);
            continue;
          }

          groupItems = mergeReceiptPageItems(groupItems, parsed);

          if (!detectedSupermarket && data?.supermarket) {
            detectedSupermarket = String(data.supermarket).trim();
          }
          if (!detectedDate && data?.date) {
            detectedDate = String(data.date).trim();
          }
        }

        // Different user-selected screenshots may contain legitimate repeated
        // purchases. Boundary deduplication happens only inside each split image.
        merged = [...merged, ...groupItems];
      }

      if (!merged.length) {
        toast({
          title: "Não consegui ler os itens",
          description:
            failures[0] ||
            "Tente um print mais nítido, com a lista de produtos, quantidades e valores visíveis.",
          variant: "destructive",
        });
        return;
      }

      setItems(merged);
      setSupermarket(detectedSupermarket);
      setReceiptDate(detectedDate || new Date().toISOString().slice(0, 10));
      setBlocked(null);
      setImageProgress("");

      toast({
        title: `${merged.length} itens encontrados`,
        description: failures.length
          ? `Revise antes de salvar. ${failures.length} trecho(s) não puderam ser lidos por completo.`
          : totalParts > originals.length
            ? `Print longo dividido automaticamente em ${totalParts} trechos. Revise antes de salvar.`
            : "Revise os produtos antes de salvar.",
      });
    } catch (error: any) {
      toast({
        title: "Erro ao ler o print",
        description:
          error?.message ?? "Não foi possível analisar a imagem da nota.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setImageProgress("");
    }
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
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        if (field === "price") {
          return { ...item, price: value, unitPrice: value };
        }
        return { ...item, [field]: value };
      }),
    );
  };

  const saveAll = async () => {
    if (!user || !items.length) return;
    setSaving(true);
    try {
      const date = receiptDate || new Date().toISOString().slice(0, 10);
      for (const item of items) {
        const name = item.name.trim();
        const price = decimalValue(item.unitPrice ?? item.price);
        if (!name || !price) continue;

        const metadata = packageMetadata(item);
        const normalizedFromItem = normalizedReceiptPrice(item);
        const { data: found, error: findError } = await supabase
          .from("products")
          .select("id,package_size,unit")
          .eq("user_id", user.id)
          .ilike("name", name)
          .limit(1);
        if (findError) throw findError;

        let productId = found?.[0]?.id;
        if (!productId) {
          const { data: created, error: createError } = await supabase
            .from("products")
            .insert({
              name,
              category: "Geral",
              user_id: user.id,
              ...(metadata ?? {}),
            })
            .select("id")
            .single();
          if (createError) throw createError;
          productId = created.id;
        } else if (
          metadata &&
          (!found?.[0]?.package_size || !found?.[0]?.unit)
        ) {
          const { error: metadataError } = await supabase
            .from("products")
            .update(metadata)
            .eq("id", productId)
            .eq("user_id", user.id);
          if (metadataError) throw metadataError;
        }

        const existingMetadata =
          found?.[0]?.package_size && found?.[0]?.unit
            ? {
                package_size: found[0].package_size,
                unit: found[0].unit,
              }
            : null;
        const effectiveMetadata = metadata ?? existingMetadata;
        const normalized =
          normalizedFromItem ??
          normalizedPriceFromPackage(price, effectiveMetadata);

        const quantity = decimalValue(item.quantity);
        const total = decimalValue(item.totalPrice);
        const unit = String(item.unit ?? "").toUpperCase();
        const details = [
          source === "qr"
            ? "Importado via QR Code NFC-e"
            : source === "key"
              ? "Importado via chave NFC-e"
              : "Importado via print/imagem da nota fiscal",
          quantity && unit ? `quantidade ${quantity} ${unit}` : null,
          unit ? `preço unitário ${price.toFixed(2)}/${unit}` : null,
          total ? `total do item ${total.toFixed(2)}` : null,
        ].filter(Boolean).join(" | ");

        const { error: priceError } = await db.from("prices").insert({
          product_id: productId,
          supermarket: supermarket.trim() || "Não informado",
          price,
          date,
          user_id: user.id,
          source: "receipt",
          package_quantity: effectiveMetadata?.package_size ?? null,
          package_unit: effectiveMetadata?.unit ?? null,
          normalized_price: normalized?.value ?? null,
          base_unit:
            normalized?.unit === "L" ? "l" : normalized?.unit ?? null,
          receipt_text: details,
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
        <p className="mt-1 text-sm text-muted-foreground">Leia o QR Code, informe a chave de 44 dígitos ou envie prints da consulta da SEFAZ. Você revisa tudo antes de salvar.</p>
      </div>

      <Tabs value={tab} onValueChange={(value) => { clearResult(); setTab(value as ImportSource); }}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="qr"><QrCode className="mr-2 h-4 w-4" />QR Code</TabsTrigger>
          <TabsTrigger value="key"><Key className="mr-2 h-4 w-4" />Chave</TabsTrigger>
          <TabsTrigger value="image"><Upload className="mr-2 h-4 w-4" />Print</TabsTrigger>
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

        <TabsContent value="image" className="mt-4 space-y-3">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                  <Upload className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Importar print da nota fiscal</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Envie um ou vários prints da NF-e/NFC-e aberta no site da SEFAZ. Prints muito longos são divididos automaticamente em trechos legíveis.
                  </p>
                </div>
              </div>

              <Input
                type="file"
                accept="image/*"
                multiple
                disabled={loading}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).slice(0, 10);
                  setImageFiles(files);
                  clearResult();
                }}
              />

              {imageFiles.length > 0 && (
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs font-semibold">
                    {imageFiles.length} imagem(ns) selecionada(s)
                  </p>
                  <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                    {imageFiles.map((file) => (
                      <p key={file.name} className="truncate">{file.name}</p>
                    ))}
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                onClick={() => void importReceiptImages()}
                disabled={loading || imageFiles.length === 0}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {imageProgress || "Ler print(s) da nota"}
              </Button>

              <p className="text-xs text-muted-foreground">
                O sistema tenta extrair estabelecimento, data, produto, quantidade, unidade, preço unitário e total do item. Em prints longos, ele divide a imagem automaticamente e junta os trechos. Nada é salvo antes da sua revisão.
              </p>
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
              {items.map((item, index) => {
                const summary = receiptItemSummary(item);
                return (
                  <div key={`${item.name}-${index}`} className="rounded-lg border p-2">
                    <div className="flex gap-2">
                      <Input value={item.name} onChange={(e) => updateItem(index, "name", e.target.value)} className="flex-1" />
                      <Input
                        value={item.price}
                        onChange={(e) => updateItem(index, "price", e.target.value)}
                        className="w-24"
                        inputMode="decimal"
                        aria-label="Preço unitário"
                      />
                      <Button variant="ghost" size="icon" onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    {summary && (
                      <p className="mt-1.5 px-1 text-[11px] font-medium text-muted-foreground">
                        {summary}
                      </p>
                    )}
                  </div>
                );
              })}
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
