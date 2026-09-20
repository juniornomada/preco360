import { useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Trash2, Save, Loader2, Sparkles, Link, QrCode, Key, Bug, AlertCircle, CheckCircle2, ScanLine } from "lucide-react";
import { QrScanner } from "@/components/QrScanner";
import { validateAccessKey, extractAccessKey, validateNfceUrl } from "@/lib/nfceKey";
import { ImportProgress } from "@/components/ImportProgress";
import { SefazBlockedNotice } from "@/components/SefazBlockedNotice";
import { SefazCaptchaAssist } from "@/components/SefazCaptchaAssist";
import { DebugAttempts } from "@/components/DebugAttempts";
import { addAttempt } from "@/lib/importLog";
import { stepFromErrorCode } from "@/components/ImportProgress";
import {
  inferPackage,
  matchFlyerItem,
  normalizeSearchText,
  normalizedUnitPrice,
  type AliasForMatch,
  type FlyerCandidate,
  type ProductForMatch,
} from "@/lib/flyerAnalysis";

interface ParsedItem {
  name: string;
  price: string;
  supermarket: string;
  category: string;
}

export default function UploadPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [supermarket, setSupermarket] = useState("");
  const [saving, setSaving] = useState(false);
  const [receiptDate, setReceiptDate] = useState("");

  // URL tab state
  const [receiptUrl, setReceiptUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [testingUrl, setTestingUrl] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Access key tab state
  const [accessKey, setAccessKey] = useState("");
  const [fetchingKey, setFetchingKey] = useState(false);
  const keyCheck = useMemo(() => validateAccessKey(accessKey), [accessKey]);
  const urlCheck = useMemo(
    () => (receiptUrl.trim() ? validateNfceUrl(receiptUrl) : null),
    [receiptUrl]
  );
  // Dados da última tentativa por chave (usados no fluxo de CAPTCHA manual)
  const [keyAttempt, setKeyAttempt] = useState<{ key: string; url: string } | null>(null);

  // Active tab + SEFAZ blocked feedback (captcha / redirect / formato inválido)
  const [tab, setTab] = useState("url");
  const [blocked, setBlocked] = useState<{ message: string; code: string; traceId?: string } | null>(null);
  // Etapa exata onde o processamento falhou (mostrada no resumo de status)
  const [failure, setFailure] = useState<{ code?: string; message: string; source: "url" | "key" | "file" } | null>(null);
  const startedAt = useRef<number>(0);
  const lastSource = useRef<"url" | "key" | "file">("url");
  const lastRequestUrl = useRef<string | undefined>(undefined);

  // Edge functions retornam o corpo JSON dentro de err.context em respostas não-2xx
  const readFunctionError = async (
    err: any
  ): Promise<{
    message: string;
    code: string;
    suggestPhoto: boolean;
    traceId?: string;
    diagnostics?: any;
    status?: number;
    finalUrl?: string;
  }> => {
    if (err?.payload?.error) {
      return {
        message: err.payload.error,
        code: err.payload.code || "UNKNOWN",
        suggestPhoto: !!err.payload.suggestPhoto,
        traceId: err.payload.traceId,
        diagnostics: err.payload.diagnostics,
        status: 200,
        finalUrl: err.payload.finalUrl,
      };
    }
    try {
      const res = err?.context;
      if (res && typeof res.json === "function") {
        const body = await res.clone().json();
        if (body?.error) {
          return {
            message: body.error,
            code: body.code || "UNKNOWN",
            suggestPhoto: !!body.suggestPhoto,
            traceId: body.traceId,
            diagnostics: body.diagnostics,
            status: res.status,
            finalUrl: body.finalUrl,
          };
        }
      }
    } catch {
      // ignora e cai no fallback
    }
    return { message: err?.message || "Erro desconhecido", code: "UNKNOWN", suggestPhoto: false };
  };

  /** Classifica o tipo de bloqueio da SEFAZ para o histórico de depuração */
  const blockTypeFromInfo = (
    code: string,
    markers?: string[],
    wasRedirected?: boolean
  ): "captcha" | "redirect" | "js_required" | "other" | undefined => {
    const m = markers ?? [];
    if (code === "CAPTCHA_REQUIRED" || m.some((x) => /captcha/i.test(x))) return "captcha";
    if (code === "JS_REQUIRED") return "js_required";
    if (code === "REDIRECTED" || wasRedirected) return "redirect";
    return undefined;
  };

  /** Mascara a chave de 44 dígitos presente na URL antes de salvar no histórico */
  const maskUrl = (url?: string) =>
    url ? url.replace(/\d{44}/g, (k) => `${k.slice(0, 6)}…${k.slice(-4)}`) : undefined;


  const handleImportError = async (err: any, source: "url" | "key" | "file" = "url") => {
    const info = await readFunctionError(err);
    const wasRedirected = info.diagnostics?.wasRedirected ?? null;
    const blockType = blockTypeFromInfo(info.code, info.diagnostics?.markers, !!wasRedirected);
    const requestedUrl = maskUrl(lastRequestUrl.current);
    const finalUrl = maskUrl(info.finalUrl);

    // Telemetria no console para depuração rápida
    console.error("[import-error]", {
      source,
      code: info.code,
      status: info.status,
      traceId: info.traceId,
      message: info.message,
      blockType,
      requestedUrl,
      finalUrl,
      diagnostics: info.diagnostics,
      at: new Date().toISOString(),
    });

    setFailure({ code: info.code, message: info.message, source });
    addAttempt({
      traceId: info.traceId,
      at: new Date().toISOString(),
      source,
      status: "error",
      step: stepFromErrorCode(info.code),
      code: info.code,
      message: info.message,
      durationMs: startedAt.current ? Date.now() - startedAt.current : undefined,
      markers: info.diagnostics?.markers,
      htmlLength: info.diagnostics?.htmlLength ?? null,
      wasRedirected,
      requestedUrl,
      finalUrl,
      blockType,
    });


    const suffix = info.traceId ? ` (ref: ${info.traceId})` : "";
    if (info.suggestPhoto) {
      setBlocked({ message: info.message, code: info.code, traceId: info.traceId });
      toast({
        title: "Não foi possível ler a página da SEFAZ",
        description: info.message + suffix,
        variant: "destructive",
      });
    } else {
      setBlocked(null);
      toast({ title: "Erro ao importar", description: info.message + suffix, variant: "destructive" });
    }
  };



  const buildSefazUrl = (key: string): string => {
    const uf = key.substring(0, 2);
    const ufUrls: Record<string, string> = {
      "35": "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx",
      "33": "https://www.nfce.fazenda.rj.gov.br/consulta",
      "31": "https://nfce.fazenda.mg.gov.br/portalnfce/sistema/consultaarg.xhtml",
      "41": "http://www.nfce.pr.gov.br/nfce/qrcode",
      "43": "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
      "29": "http://nfe.sefaz.ba.gov.br/servicos/nfce/modulos/geral/NFCEC_consulta_chave_acesso.aspx",
      "26": "http://nfce.sefaz.pe.gov.br/nfce/consulta",
      "23": "https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html",
      "52": "https://nfe.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
      "50": "https://www.dfe.ms.gov.br/nfce/qrcode",
      "53": "https://dec.fazenda.df.gov.br/NFCE/qrcode",
    };
    // SP: consulta pública por chave de acesso
    if (uf === "35") {
      return `${ufUrls["35"]}?chNFe=${key}`;
    }
    const baseUrl = ufUrls[uf];
    if (baseUrl) {
      const separator = baseUrl.includes("?") ? "&" : "?";
      return `${baseUrl}${separator}chNFe=${key}`;
    }
    return `https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=&nfe=${key}`;
  };

  const fetchFromAccessKey = async () => {
    const cleanKey = keyCheck.clean;
    if (!keyCheck.valid) {
      toast({
        title: "Chave inválida",
        description: keyCheck.error ?? "A chave de acesso deve conter exatamente 44 dígitos numéricos.",
        variant: "destructive",
      });
      return;
    }
    setFetchingKey(true);
    setItems([]);
    setBlocked(null);
    setFailure(null);
    startedAt.current = Date.now();
    const url = buildSefazUrl(cleanKey);
    lastRequestUrl.current = url;
    setKeyAttempt({ key: cleanKey, url });
    try {
      const { data, error } = await supabase.functions.invoke("fetch-receipt-url", {
        body: { url },
      });
      if (error) throw error;
       if (data?.error) throw { message: data.error, payload: data };
      handleParsedData(data);
    } catch (err: any) {
      console.error("Access key fetch error:", err);
      await handleImportError(err, "key");
    } finally {
      setFetchingKey(false);
    }

  };

  const handleFile = (f: File) => {
    setFile(f);
    setItems([]);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const runAIExtraction = async () => {
    if (!file) return;
    setProcessing(true);
    setFailure(null);
    startedAt.current = Date.now();
    lastSource.current = "file";

    try {
      let imageBase64: string | null = null;
      let mimeType = file.type;
      let ocrText = "";

      if (file.type.startsWith("image/")) {
        imageBase64 = await fileToBase64(file);
      }

      if (file.type === "application/pdf") {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport } as any).promise;
        setPreview(canvas.toDataURL());
        imageBase64 = canvas.toDataURL("image/png").split(",")[1];
        mimeType = "image/png";
      }

      try {
        const Tesseract = await import("tesseract.js");
        const source = preview || (imageBase64 ? `data:${mimeType};base64,${imageBase64}` : null);
        if (source) {
          const result = await Tesseract.recognize(source, "por");
          ocrText = result.data.text;
        }
      } catch {
        console.warn("Tesseract OCR failed, using AI vision only");
      }

      const { data, error } = await supabase.functions.invoke("parse-receipt", {
        body: { imageBase64, mimeType, ocrText },
      });

      if (error) throw error;
      if (data?.error) throw { message: data.error, payload: data };

      handleParsedData(data);
    } catch (err: any) {
      console.error("Extraction error:", err);
      setFailure({ code: "AI_ERROR", message: err.message, source: "file" });
      addAttempt({
        at: new Date().toISOString(),
        source: "file",
        status: "error",
        step: "ai",
        code: "AI_ERROR",
        message: err.message,
        durationMs: startedAt.current ? Date.now() - startedAt.current : undefined,
      });
      toast({ title: "Erro na extração", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  /** Importa a partir do texto da página da SEFAZ colado pelo usuário (contorna CAPTCHA) */
  const importFromPageText = async (pageText: string) => {
    setFetchingUrl(true);
    setItems([]);
    setBlocked(null);
    setFailure(null);
    startedAt.current = Date.now();
    lastRequestUrl.current = undefined;

    try {
      const { data, error } = await supabase.functions.invoke("fetch-receipt-url", {
        body: { pageText },
      });
      if (error) throw error;
      if (data?.error) throw { message: data.error, payload: data };

      handleParsedData(data);
      toast({ title: "Cupom lido do texto colado", description: "Revise os itens antes de salvar." });
    } catch (err: any) {
      console.error("page text import error:", err);
      await handleImportError(err, "key");
    } finally {
      setFetchingUrl(false);
    }
  };

  /** Recebe o conteúdo lido do QR Code: valida, preenche o campo e importa */
  const handleQrResult = (text: string) => {
    const check = validateNfceUrl(text);
    if (check.valid && check.url) {
      setScannerOpen(false);
      setReceiptUrl(check.url);
      fetchFromUrl(check.url);
      return;
    }

    // QR sem URL reconhecida: tenta extrair só a chave de acesso
    const key = extractAccessKey(text);
    if (key && validateAccessKey(key).valid) {
      setScannerOpen(false);
      setAccessKey(key);
      setTab("key");
      toast({
        title: "QR Code lido",
        description: "Encontrei a chave de acesso do cupom. Confira e toque em Importar.",
      });
      return;
    }

    toast({
      title: "QR Code não reconhecido",
      description: check.error ?? "O conteúdo lido não é uma consulta de NFC-e da SEFAZ.",
      variant: "destructive",
    });
  };

  const fetchFromUrl = async (overrideUrl?: string, source: "url" | "key" = "url") => {
    const raw = (overrideUrl ?? receiptUrl).trim();
    if (!raw) return;


    // Só aceita URL de consulta NFC-e válida, normalizada com o parâmetro chNFe
    const check = validateNfceUrl(raw);
    if (!check.valid || !check.url || !check.key) {
      toast({
        title: "URL de consulta inválida",
        description: check.error ?? "Cole o link completo do QR Code do cupom fiscal.",
        variant: "destructive",
      });
      return;
    }

    const targetUrl = check.url;
    setKeyAttempt({ key: check.key, url: buildSefazUrl(check.key) });

    setFetchingUrl(true);
    setItems([]);
    setBlocked(null);
    setFailure(null);
    startedAt.current = Date.now();
    lastRequestUrl.current = targetUrl;

    try {
      const { data, error } = await supabase.functions.invoke("fetch-receipt-url", {
        body: { url: targetUrl },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      handleParsedData(data);
    } catch (err: any) {
      console.error("URL fetch error:", err);
      await handleImportError(err, source);

    } finally {
      setFetchingUrl(false);
    }
  };

  /** Testa a consulta sem importar nada — apenas registra o resultado na aba Depuração */
  const testUrl = async () => {
    const raw = receiptUrl.trim();
    const check = validateNfceUrl(raw);
    if (!check.valid || !check.url || !check.key) {
      toast({
        title: "URL de consulta inválida",
        description: check.error ?? "Cole o link completo do QR Code do cupom fiscal.",
        variant: "destructive",
      });
      return;
    }

    const targetUrl = check.url;
    setTestingUrl(true);
    lastRequestUrl.current = targetUrl;
    const start = Date.now();

    try {
      const { data, error } = await supabase.functions.invoke("fetch-receipt-url", {
        body: { url: targetUrl },
      });

      if (error) throw error;
      if (data?.error) throw { message: data.error, payload: data };

      const itemCount = Array.isArray(data?.items) ? data.items.length : 0;
      addAttempt({
        traceId: data?.traceId,
        at: new Date().toISOString(),
        source: "url",
        status: "success",
        step: "teste",
        message: `Teste OK — ${itemCount} item(ns) encontrados (nada foi importado)`,
        durationMs: Date.now() - start,
        itemCount,
        supermarket: data?.supermarket,
        requestedUrl: maskUrl(targetUrl),
      });
      toast({
        title: "Consulta funcionou",
        description: `A SEFAZ respondeu com ${itemCount} item(ns). Nenhum dado foi importado.`,
      });
    } catch (err: any) {
      const info = await readFunctionError(err);
      const wasRedirected = info.diagnostics?.wasRedirected ?? null;
      addAttempt({
        traceId: info.traceId,
        at: new Date().toISOString(),
        source: "url",
        status: "error",
        step: "teste",
        code: info.code,
        message: `Teste: ${info.message}`,
        durationMs: Date.now() - start,
        markers: info.diagnostics?.markers,
        htmlLength: info.diagnostics?.htmlLength ?? null,
        wasRedirected,
        requestedUrl: maskUrl(targetUrl),
        finalUrl: maskUrl(info.finalUrl),
        blockType: blockTypeFromInfo(info.code, info.diagnostics?.markers, !!wasRedirected),
      });
      toast({
        title: "Teste falhou",
        description: info.message + (info.traceId ? ` (ref: ${info.traceId})` : ""),
        variant: "destructive",
      });
    } finally {
      setTestingUrl(false);
    }
  };



  const handleParsedData = async (data: any) => {
    setFailure(null);
    const detectedSupermarket = data.supermarket || "";
    if (detectedSupermarket) setSupermarket(detectedSupermarket);

    if (data.date) setReceiptDate(data.date);

    const parsed: ParsedItem[] = (data.items || []).map((item: any) => ({
      name: item.name || "",
      price: String(item.price || "0"),
      supermarket: detectedSupermarket || "Desconhecido",
      category: "Geral",
    }));

    if (parsed.length === 0) {
      toast({
        title: "Nenhum item encontrado",
        description: "Verifique a URL e tente novamente.",
        variant: "destructive",
      });
      setFailure({ code: "NO_ITEMS", message: "Nenhum produto encontrado no cupom.", source: tab === "file" ? "file" : "url" });
      addAttempt({
        traceId: data?.traceId,
        at: new Date().toISOString(),
        source: (tab === "file" ? "file" : tab === "key" ? "key" : "url"),
        status: "error",
        step: "items",
        code: "NO_ITEMS",
        message: "Nenhum produto encontrado no cupom.",
        durationMs: startedAt.current ? Date.now() - startedAt.current : undefined,
      });
      setItems(parsed);
      return;
    }

    toast({
      title: `${parsed.length} itens encontrados`,
      description: "Categorizando com IA...",
    });

    setItems(parsed);
    addAttempt({
      traceId: data?.traceId,
      at: new Date().toISOString(),
      source: (tab === "file" ? "file" : tab === "key" ? "key" : "url"),
      status: "success",
      itemCount: parsed.length,
      supermarket: detectedSupermarket || undefined,
      durationMs: startedAt.current ? Date.now() - startedAt.current : undefined,
    });

    // Auto-categorize with AI
    try {
      const productNames = parsed.map((p) => p.name);
      const { data: catData, error: catError } = await supabase.functions.invoke(
        "categorize-products",
        { body: { products: productNames } }
      );

      if (!catError && catData?.categories) {
        setItems((prev) =>
          prev.map((item) => {
            const cat = catData.categories[item.name] || catData.categories[item.name.trim()];
            return cat ? { ...item, category: cat } : item;
          })
        );
        toast({
          title: "Categorização concluída",
          description: "Os produtos foram categorizados automaticamente.",
        });
      }
    } catch (err) {
      console.warn("Auto-categorization failed:", err);
    }
  };

  const updateItem = (index: number, field: keyof ParsedItem, value: string) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const saveAll = async () => {
    if (!user || items.length === 0) return;
    setSaving(true);

    try {
      const dateToUse = receiptDate || new Date().toISOString().split("T")[0];

      // Deduplicate items by normalized name, keeping lowest price
      const deduped = new Map<string, ParsedItem>();
      for (const item of items) {
        const key = item.name.trim().toLowerCase();
        const existing = deduped.get(key);
        if (!existing || parseFloat(item.price) < parseFloat(existing.price)) {
          deduped.set(key, item);
        }
      }

      // Load the user's catalog and learned receipt aliases once. Receipt text
      // stays untouched; matching only decides which canonical product receives
      // the price history.
      const [{ data: catalogData, error: catalogError }, { data: aliasData, error: aliasError }] =
        await Promise.all([
          supabase
            .from("products")
            .select("id,name,category,brand,package_size,unit,stockable")
            .eq("user_id", user.id),
          supabase
            .from("product_aliases")
            .select("product_id,normalized_alias,retailer")
            .eq("user_id", user.id),
        ]);

      if (catalogError) throw catalogError;
      if (aliasError) throw aliasError;

      const catalog: ProductForMatch[] = (catalogData ?? []) as ProductForMatch[];
      const learnedAliases: AliasForMatch[] = (aliasData ?? []) as AliasForMatch[];
      const knownAliasKeys = new Set(
        learnedAliases.map(
          (alias) =>
            `${alias.normalized_alias}|${normalizeSearchText(alias.retailer ?? "")}`,
        ),
      );

      let newCount = 0;
      let linkedCount = 0;

      for (const item of deduped.values()) {
        const rawReceiptName = item.name.trim();
        const itemPrice = parseFloat(item.price);
        const packageInfo = inferPackage(rawReceiptName);
        const normalized = normalizedUnitPrice(itemPrice, packageInfo);
        const candidate: FlyerCandidate = {
          rawName: rawReceiptName,
          price: itemPrice,
          packageInfo,
          normalizedPrice: normalized.normalizedPrice,
          baseUnit: normalized.baseUnit,
          clubPrice: false,
          sourcePage: 1,
        };

        const retailerName =
          (item.supermarket || supermarket || "Desconhecido").trim() ||
          "Desconhecido";
        const aliasRetailer =
          normalizeSearchText(retailerName) === "desconhecido"
            ? null
            : retailerName;

        // Try a learned alias first and then the same semantic matcher used by
        // the Radar. It understands common receipt abbreviations and package size.
        const match = matchFlyerItem(
          candidate,
          catalog,
          learnedAliases,
          aliasRetailer ?? undefined,
        );

        let productId = match.productId;

        if (productId) {
          linkedCount++;
        } else {
          const { data: newProduct, error: pErr } = await supabase
            .from("products")
            .insert({
              name: rawReceiptName,
              category: item.category || "Geral",
              package_size: packageInfo?.quantity ?? null,
              unit: packageInfo?.unit ?? null,
              user_id: user.id,
            })
            .select("id,name,category,brand,package_size,unit,stockable")
            .single();
          if (pErr) throw pErr;

          productId = newProduct.id;
          catalog.push(newProduct as ProductForMatch);
          newCount++;
        }

        // Learn the exact fiscal description for this retailer. Future receipts
        // can then link immediately even when the canonical display name differs.
        const normalizedAlias = normalizeSearchText(rawReceiptName);
        const aliasKey =
          `${normalizedAlias}|${normalizeSearchText(aliasRetailer ?? "")}`;

        if (normalizedAlias && !knownAliasKeys.has(aliasKey)) {
          const { error: aliasInsertError } = await supabase
            .from("product_aliases")
            .insert({
              user_id: user.id,
              product_id: productId,
              alias: rawReceiptName,
              normalized_alias: normalizedAlias,
              retailer: aliasRetailer,
            });

          if (aliasInsertError) throw aliasInsertError;

          knownAliasKeys.add(aliasKey);
          learnedAliases.push({
            product_id: productId,
            normalized_alias: normalizedAlias,
            retailer: aliasRetailer,
          });
        }

        const { error: prErr } = await supabase.from("prices").insert({
          product_id: productId,
          supermarket: retailerName,
          price: itemPrice,
          date: dateToUse,
          user_id: user.id,
          source: "receipt",
          receipt_text: rawReceiptName,
        });
        if (prErr) throw prErr;
      }

      const parts = [];
      if (newCount > 0) parts.push(`${newCount} novo(s)`);
      if (linkedCount > 0) parts.push(`${linkedCount} vinculado(s)`);
      toast({ title: "Salvo!", description: `${parts.join(", ")} — ${deduped.size} preços registrados.` });
      setItems([]);
      setFile(null);
      setPreview(null);
      setReceiptUrl("");
      setReceiptDate("");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <h1 className="mb-4 text-xl font-bold">Upload de Cupom</h1>

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList className="w-full">
          <TabsTrigger value="url" className="flex-1">
            <QrCode className="mr-1.5 h-4 w-4" />
            URL do QR Code
          </TabsTrigger>
          <TabsTrigger value="key" className="flex-1">
            <Key className="mr-1.5 h-4 w-4" />
            Chave de Acesso
          </TabsTrigger>
          <TabsTrigger value="file" className="flex-1">
            <Upload className="mr-1.5 h-4 w-4" />
            Imagem / PDF
          </TabsTrigger>
          <TabsTrigger value="debug" className="flex-1">
            <Bug className="mr-1.5 h-4 w-4" />
            Depuração
          </TabsTrigger>
        </TabsList>

        {/* URL Tab */}
        <TabsContent value="url" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cole a URL do QR Code do cupom fiscal (NFC-e). Geralmente começa com o site da SEFAZ do seu estado.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="https://www.nfce.fazenda..."
                value={receiptUrl}
                onChange={(e) => setReceiptUrl(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && fetchFromUrl()}
              />
            </div>
            <Button
              onClick={() => fetchFromUrl()}
              disabled={fetchingUrl || testingUrl || !receiptUrl.trim() || !urlCheck?.valid}
            >
              {fetchingUrl ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Importar
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={testUrl}
              disabled={fetchingUrl || testingUrl || !urlCheck?.valid}
            >
              {testingUrl ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bug className="h-4 w-4" />
              )}
              Testar URL
            </Button>
            <span className="text-xs text-muted-foreground">
              Verifica a consulta e registra na aba Depuração, sem importar dados.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setScannerOpen((v) => !v)}
              disabled={fetchingUrl || testingUrl}
            >
              <ScanLine className="mr-1.5 h-4 w-4" />
              {scannerOpen ? "Fechar leitor de QR Code" : "Escanear QR Code"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Use a câmera ou uma foto do cupom — importamos automaticamente.
            </span>
          </div>

          {scannerOpen && (
            <QrScanner onResult={handleQrResult} onClose={() => setScannerOpen(false)} />
          )}


          {urlCheck && !urlCheck.valid && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{urlCheck.error}</span>
            </p>
          )}
          {urlCheck?.valid && (
            <p className="flex items-start gap-2 text-sm text-primary">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>URL válida · chNFe {urlCheck.key}</span>
            </p>
          )}
          <ImportProgress active={fetchingUrl} mode="url" failure={tab === "url" ? failure : null} />

          {blocked && !fetchingUrl && (
            <SefazBlockedNotice
              message={blocked.message}
              code={blocked.code}
              traceId={blocked.traceId}
              onSendPhoto={() => {
                setBlocked(null);
                setTab("file");
              }}
            />
          )}
        </TabsContent>
        {/* Access Key Tab */}
        <TabsContent value="key" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cole a chave de acesso de 44 dígitos que aparece no cupom fiscal (NFC-e).
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text");
                  // aceita chave colada de dentro de qualquer variação de URL (chNFe=, p=, chave=, fragmento)
                  setAccessKey(extractAccessKey(text) ?? text.trim());
                }}
                className={`pl-9 font-mono text-sm ${
                  accessKey && !keyCheck.valid
                    ? "border-destructive focus-visible:ring-destructive"
                    : keyCheck.valid
                    ? "border-primary"
                    : ""
                }`}
                maxLength={53}
                aria-invalid={!!accessKey && !keyCheck.valid}
                onKeyDown={(e) => e.key === "Enter" && keyCheck.valid && fetchFromAccessKey()}
              />
            </div>
            <Button onClick={fetchFromAccessKey} disabled={fetchingKey || !keyCheck.valid}>
              {fetchingKey ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Importar
            </Button>
          </div>

          {accessKey && keyCheck.error && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{keyCheck.error}</span>
            </p>
          )}
          {keyCheck.valid && (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-xs text-primary">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Chave válida · {keyCheck.uf} · emissão {keyCheck.emitted} ·{" "}
                  {keyCheck.model === "65" ? "NFC-e (modelo 65)" : `modelo ${keyCheck.model}`}
                </span>
              </p>
              {keyCheck.warning && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{keyCheck.warning}</span>
                </p>
              )}
            </div>
          )}
          {!accessKey && (
            <p className="text-xs text-muted-foreground">
              A chave possui 44 dígitos numéricos e pode ser encontrada no rodapé do cupom fiscal.
            </p>
          )}
          {accessKey && !keyCheck.valid && !keyCheck.error && (
            <p className="text-xs text-muted-foreground">
              {keyCheck.clean.length}/44 dígitos digitados.
            </p>
          )}

          <ImportProgress active={fetchingKey || fetchingUrl} mode="url" failure={tab === "key" ? failure : null} />
          {blocked && !fetchingKey && keyAttempt && (
            <SefazCaptchaAssist
              accessKey={keyAttempt.key}
              sefazUrl={keyAttempt.url}
              message={blocked.message}
              code={blocked.code}
              traceId={blocked.traceId}
              importing={fetchingUrl}
              onImportUrl={(u) => fetchFromUrl(u, "key")}
              onImportText={(t) => importFromPageText(t)}
              onSendPhoto={() => {
                setBlocked(null);
                setTab("file");
              }}
            />
          )}
        </TabsContent>

        {/* File Tab */}
        <TabsContent value="file" className="space-y-3">
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-6 transition-colors hover:border-primary/50"
            onClick={() => document.getElementById("file-input")?.click()}
          >
            {preview ? (
              <img src={preview} alt="Preview" className="max-h-48 rounded-lg object-contain" />
            ) : (
              <>
                <Upload className="h-10 w-10 text-primary/50" />
                <p className="text-sm text-muted-foreground">
                  Arraste uma imagem ou PDF do cupom fiscal
                </p>
                <p className="text-xs text-muted-foreground">JPG, PNG ou PDF</p>
              </>
            )}
            <input
              id="file-input"
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>

          {file && (
            <Button onClick={runAIExtraction} disabled={processing} className="w-full">
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analisando cupom...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Extrair Produtos (IA)
                </>
              )}
            </Button>
          )}
          <ImportProgress active={processing} mode="file" failure={tab === "file" ? failure : null} />
        </TabsContent>

        {/* Debug Tab */}
        <TabsContent value="debug" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Histórico das últimas tentativas de importação com código de diagnóstico, etapa da falha e marcadores detectados na página da SEFAZ.
          </p>
          <DebugAttempts />
        </TabsContent>
      </Tabs>

      {/* Supermarket & Date */}
      {items.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 text-sm font-medium">Supermercado</label>
            <Input
              placeholder="Nome do supermercado"
              value={supermarket}
              onChange={(e) => setSupermarket(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 text-sm font-medium">Data</label>
            <Input
              type="date"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Editable items table */}
      {items.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Itens Extraídos ({items.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-md border bg-background p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(i, "name", e.target.value)}
                    className="flex-1 text-sm"
                    placeholder="Produto"
                  />
                  <Input
                    value={item.price}
                    onChange={(e) => updateItem(i, "price", e.target.value)}
                    className="w-24 text-sm"
                    placeholder="Preço"
                  />
                  <Button variant="ghost" size="icon" onClick={() => removeItem(i)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <Select value={item.category} onValueChange={(v) => updateItem(i, "category", v)}>
                  <SelectTrigger className="h-6 w-fit gap-1 border-none bg-secondary px-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Geral","Frutas","Verduras e Legumes","Carnes","Aves","Peixes e Frutos do Mar","Laticínios","Padaria","Bebidas","Grãos e Cereais","Enlatados","Congelados","Higiene Pessoal","Limpeza","Pet","Outros"].map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <Button onClick={saveAll} disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salvar {items.length} produtos
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
