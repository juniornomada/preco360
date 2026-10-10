import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { QrScanner } from "@/components/QrScanner";
import { buildOfficialConsultationUrl, extractAccessKey, fiscalDocumentKind, fiscalDocumentLabel, validateAccessKey, validateNfceUrl } from "@/lib/nfceKey";
import { inferPackage } from "@/lib/flyerAnalysis";
import { sanitizeAccessKeyDigits } from "@/lib/accessKeyVoice";
import { useAccessKeyVoice } from "@/hooks/useAccessKeyVoice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Camera, CheckCircle2, ExternalLink, Key, Loader2, Mic, QrCode, ReceiptText, RefreshCw, Save, Trash2, Upload } from "lucide-react";

const db = supabase as any;

type ParsedItem = {
  name: string;
  price: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  totalPrice?: string;
  barcode?: string;
};
type ImportSource = "qr" | "key" | "image";
const RECEIPT_CHANNEL = "preco360-receipt-import";
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

function consolidateReceiptItemsForSave(items: ParsedItem[]) {
  const grouped = new Map<
    string,
    ParsedItem & { __quantityTotal?: number; __itemTotal?: number }
  >();

  const normalizedSaleUnit = (value?: string) => {
    const unit = String(value ?? "").trim().toUpperCase();
    if (unit === "UND" || unit === "UNID") return "UN";
    if (unit === "LT") return "L";
    return unit;
  };

  for (const item of items) {
    const name = item.name.trim();
    const unitPrice = decimalValue(item.unitPrice ?? item.price);
    if (!name || !unitPrice) continue;

    const normalizedName = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const saleUnit = normalizedSaleUnit(item.unit);
    const identity =
      item.barcode?.trim()
        ? `gtin:${item.barcode.trim()}`
        : normalizedName;
    const key = [
      identity,
      unitPrice.toFixed(6),
      saleUnit,
    ].join("|");

    const quantity = decimalValue(item.quantity);
    const total = decimalValue(item.totalPrice);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...item,
        unit: saleUnit || item.unit,
        __quantityTotal: quantity ?? undefined,
        __itemTotal:
          total ??
          (quantity ? quantity * unitPrice : undefined),
      });
      continue;
    }

    const nextQuantity =
      (existing.__quantityTotal ?? 0) + (quantity ?? 0);
    const nextTotal =
      (existing.__itemTotal ?? 0) +
      (total ?? (quantity ? quantity * unitPrice : 0));

    existing.__quantityTotal =
      nextQuantity > 0 ? nextQuantity : undefined;
    existing.__itemTotal =
      nextTotal > 0 ? nextTotal : undefined;
  }

  return [...grouped.values()].map((item) => ({
    name: item.name,
    price: item.price,
    unitPrice: item.unitPrice,
    unit: item.unit,
    quantity: item.__quantityTotal
      ? String(Number(item.__quantityTotal.toFixed(4)))
      : item.quantity,
    totalPrice: item.__itemTotal
      ? item.__itemTotal.toFixed(2)
      : item.totalPrice,
    barcode: item.barcode,
  }));
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

function receiptFileKind(file: File) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();

  if (
    type.startsWith("image/") ||
    /\.(?:png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(name)
  ) {
    return "image" as const;
  }
  if (type === "application/pdf" || /\.pdf$/i.test(name)) {
    return "pdf" as const;
  }
  if (
    type === "text/html" ||
    type === "application/xhtml+xml" ||
    /\.html?$/i.test(name)
  ) {
    return "html" as const;
  }
  return "unsupported" as const;
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
  const navigate = useNavigate();
  const {
    isSupported: isKeyVoiceSupported,
    isListening: isKeyVoiceListening,
    error: keyVoiceError,
    clearError: clearKeyVoiceError,
    startListening: startKeyVoiceListening,
    stopListening: stopKeyVoiceListening,
  } = useAccessKeyVoice();
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
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [fileProgress, setFileProgress] = useState("");
  const [assistedKeyUrl, setAssistedKeyUrl] = useState("");
  const [assistedKeyPending, setAssistedKeyPending] = useState(false);
  const [assistedKeyStatus, setAssistedKeyStatus] = useState<
    "idle" | "waiting" | "checking" | "session-required" | "success"
  >("idle");
  const assistedOpenedAtRef = useRef(0);
  const assistedAttemptedRef = useRef(false);

  const keyCheck = useMemo(() => validateAccessKey(accessKey), [accessKey]);
  const keyKind = useMemo(
    () => fiscalDocumentKind(accessKey),
    [accessKey],
  );
  const accessKeyDigits = useMemo(
    () => sanitizeAccessKeyDigits(accessKey),
    [accessKey],
  );

  const clearResult = () => {
    setItems([]);
    setSupermarket("");
    setReceiptDate("");
    setBlocked(null);
    setPageText("");
    setFileProgress("");
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
            barcode: item?.barcode ? String(item.barcode) : undefined,
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


  const normalizeReceiptItems = (data: any) =>
    (Array.isArray(data?.items) ? data.items : [])
      .map((item: any) => ({
        name: String(item?.name ?? "").trim(),
        price: String(item?.price ?? item?.unitPrice ?? item?.totalPrice ?? ""),
        quantity: item?.quantity ? String(item.quantity) : undefined,
        unit: item?.unit ? String(item.unit) : undefined,
        unitPrice: item?.unitPrice ? String(item.unitPrice) : undefined,
        totalPrice: item?.totalPrice ? String(item.totalPrice) : undefined,
        barcode: item?.barcode ? String(item.barcode) : undefined,
      }))
      .filter(
        (item: ParsedItem) =>
          item.name && Number(String(item.price).replace(",", ".")) > 0,
      );

  const importReceiptFiles = async () => {
    if (!receiptFiles.length) return;
    const originals = [...receiptFiles];
    setLoading(true);
    clearResult();
    setSource("image");

    let merged: ParsedItem[] = [];
    let detectedSupermarket = "";
    let detectedDate = "";
    const failures: string[] = [];

    try {
      setFileProgress("Preparando arquivo(s)…");

      const groups: Array<{
        kind: "image" | "pdf" | "html";
        original: File;
        parts: File[];
      }> = [];

      for (const original of originals) {
        const kind = receiptFileKind(original);
        if (kind === "unsupported") {
          failures.push(
            `${original.name}: formato não suportado. Use imagem, PDF ou HTML.`,
          );
          continue;
        }

        groups.push({
          kind,
          original,
          parts:
            kind === "image"
              ? await splitLongReceiptImage(original)
              : [original],
        });
      }

      const totalParts = groups.reduce((sum, group) => sum + group.parts.length, 0);
      let partNumber = 0;

      for (const group of groups) {
        let groupItems: ParsedItem[] = [];

        for (const file of group.parts) {
          partNumber += 1;
          const label =
            group.kind === "image" && group.parts.length > 1
              ? "trecho"
              : group.kind === "pdf"
                ? "PDF"
                : group.kind === "html"
                  ? "HTML"
                  : "imagem";

          setFileProgress(
            `Lendo ${label} ${partNumber} de ${totalParts}…`,
          );

          let data: any = null;
          let error: any = null;

          if (group.kind === "html") {
            const pageText = await file.text();
            if (pageText.trim().length < 40) {
              failures.push(`${file.name}: HTML vazio ou sem conteúdo legível`);
              continue;
            }

            const response = await supabase.functions.invoke(
              "fetch-receipt-url",
              { body: { pageText } },
            );
            data = response.data;
            error = response.error;

            if (!error && data?.error) {
              failures.push(
                `${file.name}: ${String(data?.error || "HTML não reconhecido")}`,
              );
              continue;
            }
          } else {
            const formData = new FormData();
            formData.append("file", file);

            const response = await supabase.functions.invoke(
              "analyze-receipt-image",
              { body: formData },
            );
            data = response.data;
            error = response.error;
          }

          if (error) {
            failures.push(
              `${file.name}: ${await edgeFunctionErrorMessage(error)}`,
            );
            continue;
          }

          const parsed = normalizeReceiptItems(data);
          if (!parsed.length) {
            failures.push(`${file.name}: nenhum item legível encontrado`);
            continue;
          }

          groupItems =
            group.kind === "image" && group.parts.length > 1
              ? mergeReceiptPageItems(groupItems, parsed)
              : [...groupItems, ...parsed];

          if (!detectedSupermarket && data?.supermarket) {
            detectedSupermarket = String(data.supermarket).trim();
          }
          if (!detectedDate && data?.date) {
            detectedDate = String(data.date).trim();
          }
        }

        merged = [...merged, ...groupItems];
      }

      if (!merged.length) {
        toast({
          title: "Não consegui ler os itens",
          description:
            failures[0] ||
            "Tente outro arquivo ou confirme se a nota contém a lista de produtos e valores.",
          variant: "destructive",
        });
        return;
      }

      setItems(merged);
      setSupermarket(detectedSupermarket);
      setReceiptDate(detectedDate || new Date().toISOString().slice(0, 10));
      setBlocked(null);
      setFileProgress("");

      toast({
        title: `${merged.length} itens encontrados`,
        description: failures.length
          ? `Revise antes de salvar. ${failures.length} arquivo(s)/trecho(s) não puderam ser lidos por completo.`
          : groups.some(
                (group) => group.kind === "image" && group.parts.length > 1,
              )
            ? "Print longo dividido automaticamente em trechos. Revise antes de salvar."
            : "Revise os produtos antes de salvar.",
      });
    } catch (error: any) {
      toast({
        title: "Erro ao ler o arquivo",
        description:
          error?.message ?? "Não foi possível analisar a nota fiscal.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setFileProgress("");
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

  const openAssistedKeyConsultation = () => {
    if (!keyCheck.valid || keyKind === "unknown") return;

    clearResult();
    setSource("key");

    const isSpNfce =
      keyKind === "nfce" && keyCheck.clean.startsWith("35");

    if (isSpNfce) {
      sessionStorage.removeItem("preco360.receipt.assisted");
      try {
        localStorage.removeItem("preco360.receipt.import-result");
      } catch {
        // sem impacto se o armazenamento local estiver indisponível
      }
      setAssistedKeyPending(true);
      setAssistedKeyStatus("waiting");
      assistedOpenedAtRef.current = Date.now();

      const popupUrl =
        `/sefaz-sp-nfce?key=${encodeURIComponent(keyCheck.clean)}`;
      const opened = window.open(popupUrl, "_blank");

      if (!opened) {
        setAssistedKeyPending(false);
        toast({
          title: "O navegador bloqueou a nova aba",
          description:
            "Permita a abertura de nova aba para validar o CAPTCHA da SEFAZ-SP.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "CAPTCHA aberto em outra aba",
        description:
          "Digite os caracteres na nova aba. Quando a NFC-e for lida, os itens voltarão automaticamente para esta tela.",
      });
      return;
    }

    const url = buildOfficialConsultationUrl(keyCheck.clean);
    if (!url) {
      toast({
        title: "Modelo ainda não suportado",
        description: "Essa chave não é NF-e modelo 55 nem NFC-e modelo 65.",
        variant: "destructive",
      });
      return;
    }

    setLastUrl(url);
    setAssistedKeyUrl(url);
    setAssistedKeyPending(true);
    setAssistedKeyStatus("waiting");
    assistedOpenedAtRef.current = Date.now();
    assistedAttemptedRef.current = false;

    sessionStorage.setItem(
      "preco360.receipt.assisted",
      JSON.stringify({
        key: keyCheck.clean,
        url,
        startedAt: assistedOpenedAtRef.current,
      }),
    );

    const opened = window.open(url, "_blank");
    if (!opened) {
      setAssistedKeyPending(false);
      toast({
        title: "O navegador bloqueou a nova aba",
        description: "Permita pop-ups para abrir a consulta oficial da SEFAZ.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    const seenResultIds = new Set<string>();

    const receive = (message: any) => {
      if (
        !message ||
        message.type !== "preco360:receipt-import" ||
        !message.payload
      ) {
        return;
      }

      const resultId = String(message.resultId || "");
      if (resultId && seenResultIds.has(resultId)) return;
      if (resultId) seenResultIds.add(resultId);

      applyResult(message.payload, "key");
      setAssistedKeyPending(false);
      setAssistedKeyStatus("success");
      sessionStorage.removeItem("preco360.receipt.assisted");
      try {
        localStorage.removeItem("preco360.receipt.import-result");
      } catch {
        // sem impacto no fluxo principal
      }
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      receive(event.data);
    };

    window.addEventListener("message", onWindowMessage);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(RECEIPT_CHANNEL);
      channel.onmessage = (event) => receive(event.data);
    } catch {
      channel = null;
    }

    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== "preco360.receipt.import-result" ||
        !event.newValue
      ) {
        return;
      }
      try {
        const saved = JSON.parse(event.newValue);
        receive(saved?.message);
      } catch {
        // ignora dados incompletos
      }
    };
    window.addEventListener("storage", onStorage);

    try {
      const existing = localStorage.getItem(
        "preco360.receipt.import-result",
      );
      if (existing) {
        const saved = JSON.parse(existing);
        if (Date.now() - Number(saved?.sentAt || 0) < 5 * 60 * 1000) {
          receive(saved?.message);
        } else {
          localStorage.removeItem("preco360.receipt.import-result");
        }
      }
    } catch {
      // fallback indisponível
    }

    return () => {
      window.removeEventListener("message", onWindowMessage);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, []);



  useEffect(() => {
    const raw = sessionStorage.getItem("preco360.receipt.assisted");
    if (!raw || assistedKeyPending) return;

    try {
      const saved = JSON.parse(raw);
      const startedAt = Number(saved?.startedAt) || 0;
      if (
        !saved?.key ||
        !saved?.url ||
        Date.now() - startedAt > 30 * 60 * 1000
      ) {
        sessionStorage.removeItem("preco360.receipt.assisted");
        return;
      }

      setAccessKey(String(saved.key));
      setTab("key");
      setSource("key");
      setLastUrl(String(saved.url));
      setAssistedKeyUrl(String(saved.url));
      setAssistedKeyPending(true);
      setAssistedKeyStatus("waiting");
      assistedOpenedAtRef.current = startedAt;
      assistedAttemptedRef.current = false;
    } catch {
      sessionStorage.removeItem("preco360.receipt.assisted");
    }
  }, [assistedKeyPending]);

  useEffect(() => {
    const resume = () => {
      if (
        !assistedKeyPending ||
        !assistedKeyUrl ||
        Date.now() - assistedOpenedAtRef.current < 2500
      ) {
        return;
      }

      // A sessão do CAPTCHA pertence ao domínio da SEFAZ e não é compartilhada
      // com o Preço 360. Portanto, ao retornar da aba oficial, apenas preservamos
      // o estado da consulta; não repetimos uma chamada que inevitavelmente
      // receberia outro CAPTCHA e pareceria um erro para o usuário.
      setAssistedKeyStatus("session-required");
    };

    window.addEventListener("focus", resume);
    const onVisibility = () => {
      if (document.visibilityState === "visible") resume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [assistedKeyPending, assistedKeyUrl]);



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
      const itemsToSave = consolidateReceiptItemsForSave(items);

      const batchItems = itemsToSave
        .map((item) => {
          const name = item.name.trim();
          const price = decimalValue(item.unitPrice ?? item.price);
          if (!name || !price) return null;

          const metadata = packageMetadata(item);
          const normalizedFromItem = normalizedReceiptPrice(item);
          const normalized =
            normalizedFromItem ??
            normalizedPriceFromPackage(price, metadata);

          const quantity = decimalValue(item.quantity);
          const total = decimalValue(item.totalPrice);
          const unit = String(item.unit ?? "").toUpperCase();
          const details = [
            source === "qr"
              ? "Importado via QR Code NFC-e"
              : source === "key"
                ? "Importado via chave NFC-e"
                : "Importado via arquivo da nota fiscal (imagem/PDF/HTML)",
            quantity && unit ? `quantidade ${quantity} ${unit}` : null,
            unit ? `preço unitário ${price.toFixed(2)}/${unit}` : null,
            total ? `total do item ${total.toFixed(2)}` : null,
            item.barcode ? `GTIN ${item.barcode}` : null,
          ]
            .filter(Boolean)
            .join(" | ");

          return {
            name,
            price: price.toFixed(6),
            barcode: item.barcode ?? null,
            package_quantity: metadata?.package_size ?? null,
            package_unit: metadata?.unit ?? null,
            normalized_price: normalized?.value ?? null,
            base_unit:
              normalized?.unit === "L" ? "l" : normalized?.unit ?? null,
            receipt_text: details,
          };
        })
        .filter(Boolean);

      if (!batchItems.length) {
        throw new Error("Nenhum item válido para salvar.");
      }

      const { data: saved, error: saveError } = await db.rpc(
        "save_receipt_price_batch",
        {
          p_supermarket: supermarket.trim() || "Não informado",
          p_date: date,
          p_items: batchItems,
        },
      );
      if (saveError) throw saveError;

      const result = saved?.[0];
      const savedCount = Number(result?.saved_prices ?? batchItems.length);
      const createdCount = Number(result?.created_products ?? 0);
      const reusedCount = Number(result?.reused_products ?? 0);
      const consolidatedCount = items.length - itemsToSave.length;

      toast({
        title: "Produtos salvos com sucesso",
        description: [
          `${savedCount} preço(s) gravado(s)`,
          `${createdCount} produto(s) novo(s)`,
          `${reusedCount} produto(s) reaproveitado(s)`,
          consolidatedCount > 0
            ? `${consolidatedCount} repetição(ões) consolidadas`
            : null,
          "Voltando para o Início…",
        ]
          .filter(Boolean)
          .join(" · "),
      });

      clearResult();
      setAccessKey("");

      window.setTimeout(() => {
        navigate("/", { replace: true });
      }, 1200);
    } catch (error: any) {
      toast({
        title: "Erro ao salvar",
        description:
          (error?.message ?? "Não foi possível salvar os preços.") +
          " Nenhum item deste lote deve ser gravado se a transação falhar.",
        variant: "destructive",
      });
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
        <p className="mt-1 text-sm text-muted-foreground">Leia o QR Code, informe a chave de 44 dígitos ou envie imagem, PDF ou HTML da consulta da SEFAZ. Você revisa tudo antes de salvar.</p>
      </div>

      <Tabs value={tab} onValueChange={(value) => { clearResult(); setTab(value as ImportSource); }}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="qr"><QrCode className="mr-2 h-4 w-4" />QR Code</TabsTrigger>
          <TabsTrigger value="key"><Key className="mr-2 h-4 w-4" />Chave</TabsTrigger>
          <TabsTrigger value="image"><Upload className="mr-2 h-4 w-4" />Arquivo</TabsTrigger>
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
              <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-primary">
                  Digite ou fale a chave aqui
                </p>
                <div className="flex gap-2">
                  <Input
                    value={accessKey}
                    onChange={(e) => {
                      clearKeyVoiceError();
                      setAccessKey(
                        extractAccessKey(e.target.value) ??
                          sanitizeAccessKeyDigits(e.target.value),
                      );
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="44 dígitos da chave de acesso"
                    className="h-12 min-w-0 flex-1 border-2 border-primary/50 bg-primary/5 font-mono text-base shadow-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                  />
                  <Button
                    type="button"
                    variant={isKeyVoiceListening ? "default" : "outline"}
                    className={isKeyVoiceListening ? "animate-pulse shrink-0" : "shrink-0"}
                    disabled={!isKeyVoiceSupported || loading}
                    onClick={() => {
                      if (isKeyVoiceListening) {
                        stopKeyVoiceListening();
                        return;
                      }

                      startKeyVoiceListening(accessKeyDigits, (digits, complete) => {
                        setAccessKey(digits);
                        if (complete) {
                          toast({
                            title: "44 dígitos capturados",
                            description: "A chave foi preenchida por voz. Confira a validação abaixo.",
                          });
                        }
                      });
                    }}
                  >
                    <Mic className="mr-2 h-4 w-4" />
                    {isKeyVoiceListening ? "Parar" : "Falar chave"}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>
                    {isKeyVoiceListening
                      ? "Ouvindo… fale um número por vez."
                      : isKeyVoiceSupported
                        ? "Você também pode ditar a chave, um número por vez."
                        : "Ditado por voz indisponível neste navegador."}
                  </span>
                  <span className="shrink-0 font-mono font-semibold">
                    {accessKeyDigits.length}/44
                  </span>
                </div>
                {keyVoiceError && (
                  <p className="text-xs text-destructive">{keyVoiceError}</p>
                )}
              </div>
              {accessKey && !keyCheck.valid && <p className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{keyCheck.error}</p>}
              {keyCheck.valid && (
                <p className="flex gap-2 text-sm text-primary">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  {fiscalDocumentLabel(keyCheck.clean)} · {keyCheck.uf} · {keyCheck.emitted}
                </p>
              )}
              {keyCheck.warning && (
                <p className="text-sm text-amber-600">{keyCheck.warning}</p>
              )}
              <Button
                onClick={openAssistedKeyConsultation}
                disabled={!keyCheck.valid || keyKind === "unknown" || loading}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {keyKind === "nfce" && keyCheck.clean.startsWith("35")
                  ? "Abrir CAPTCHA e importar"
                  : "Abrir SEFAZ e validar CAPTCHA"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {keyKind === "nfce" && keyCheck.clean.startsWith("35")
                  ? "Para NFC-e de São Paulo, o CAPTCHA abre em outra aba do Preço 360. Depois da validação, os produtos retornam automaticamente para revisão nesta tela."
                  : "A consulta oficial abre em outra aba. Depois de validar o CAPTCHA, feche a aba para voltar ao Preço 360."}
              </p>

              {assistedKeyPending && (
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-sm font-semibold">
                    {keyKind === "nfce" && keyCheck.clean.startsWith("35")
                      ? "Aguardando validação da NFC-e"
                      : assistedKeyStatus === "session-required"
                        ? "Consulta aberta na SEFAZ"
                        : "Consulta oficial preparada"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {keyKind === "nfce" && keyCheck.clean.startsWith("35")
                      ? "Mantenha esta aba aberta. Após digitar o CAPTCHA na outra aba, os itens devem aparecer aqui automaticamente para revisão."
                      : "Depois de consultar a nota na SEFAZ, feche a outra aba para retornar ao Preço 360."}
                  </p>
                </div>
              )}
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
                  <p className="font-semibold">Importar arquivo da nota fiscal</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Envie imagem, PDF ou HTML da NF-e/NFC-e consultada na SEFAZ. Prints muito longos são divididos automaticamente em trechos legíveis.
                  </p>
                </div>
              </div>

              <Input
                type="file"
                accept="image/*,.pdf,.html,.htm,application/pdf,text/html"
                multiple
                disabled={loading}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).slice(0, 10);
                  setReceiptFiles(files);
                  clearResult();
                }}
              />

              {receiptFiles.length > 0 && (
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs font-semibold">
                    {receiptFiles.length} arquivo(s) selecionado(s)
                  </p>
                  <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                    {receiptFiles.map((file) => (
                      <p key={file.name} className="truncate">{file.name}</p>
                    ))}
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                onClick={() => void importReceiptFiles()}
                disabled={loading || receiptFiles.length === 0}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {fileProgress || "Ler arquivo(s) da nota"}
              </Button>

              <p className="text-xs text-muted-foreground">
                O sistema aceita imagem, PDF e HTML e tenta extrair estabelecimento, data, produto, quantidade, unidade, preço unitário e total do item. Em prints longos, divide a imagem automaticamente e junta os trechos. Nada é salvo antes da sua revisão.
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
