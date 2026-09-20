import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileImage,
  FileText,
  HelpCircle,
  History,
  Loader2,
  Minus,
  MinusCircle,
  Plus,
  Radar,
  Save,
  ShoppingBasket,
  Sparkles,
  Store,
  Tags,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import {
  evaluateFlyerOffer,
  extractFlyerMeta,
  formatNormalizedPrice,
  inferPackage,
  matchFlyerItem,
  normalizeSearchText,
  normalizedUnitPrice,
  type FlyerCandidate,
  type ProductForMatch,
} from "@/lib/flyerAnalysis";
import {
  countFlyerPages,
  visionResponseToFlyerResult,
  type VisionResponse,
} from "@/lib/flyerOcr";
import {
  forceProductVisual,
  productVisual,
} from "@/lib/productVisualResolver";

const db = supabase as any;
type MatchType = "exact" | "equivalent" | "suggested" | "manual" | "unmatched";
type ReviewItem = FlyerCandidate & {
  localId: string;
  productId: string | null;
  matchConfidence: number;
  matchType: MatchType;
};
type View = "radar" | "import" | "history";
type FlyerImportJob = {
  id: string;
  status: "queued" | "processing" | "refining" | "completed" | "failed";
  progress_current: number;
  progress_total: number;
  progress_label: string;
  source_file_path: string;
  source_file_name: string;
  mime_type: string | null;
  source_files: Array<{
    path: string;
    name: string;
    mime_type?: string | null;
    size?: number | null;
  }> | null;
  file_hash: string | null;
  page_count: number | null;
  retailer: string | null;
  valid_from: string | null;
  valid_to: string | null;
  result: VisionResponse | null;
  missing_pages: number[];
  warning_message: string | null;
  error_message: string | null;
  updated_at: string | null;
};
type SourceFileEntry = {
  path: string;
  name: string;
  mime_type?: string | null;
  size?: number | null;
};

type ProcessedSource = {
  path: string;
  fileHash: string | null;
  fileName: string;
  mimeType: string | null;
  pageCount: number | null;
  sourceFiles?: SourceFileEntry[];
};
const IMPORT_JOB_KEY = "preco360-active-flyer-import-job";

const rank = { exceptional: 0, good: 1, normal: 2, high: 3, unknown: 4 } as const;
const cardTone = {
  exceptional: "border-emerald-500/40 bg-emerald-500/10",
  good: "border-green-500/30 bg-green-500/5",
  normal: "border-border bg-card",
  high: "border-amber-500/30 bg-amber-500/5",
  unknown: "border-border bg-card",
} as const;

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const comparableUnit = (unit: "kg" | "l" | "un") =>
  unit === "l" ? "L" : unit;

const offerPriceWithReference = (
  price: number,
  normalizedPrice: number,
  baseUnit: "kg" | "l" | "un",
) => {
  if (baseUnit === "un" || !Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    return brl(price);
  }

  const normalized = `${brl(normalizedPrice)}/${comparableUnit(baseUnit)}`;
  if (Math.abs(price - normalizedPrice) < 0.005) return normalized;
  return `${brl(price)} (${normalized})`;
};

const historicalReferenceLabel = (
  referencePrice: number | null,
  baseUnit: "kg" | "l" | "un",
) => {
  if (!referencePrice || !Number.isFinite(referencePrice)) return null;
  if (baseUnit === "un") return brl(referencePrice);
  return `${brl(referencePrice)}/${comparableUnit(baseUnit)}`;
};

const dateBr = (value?: string | null) => {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

const visualTone = (key: "exceptional" | "good" | "normal" | "high" | "unknown") => {
  if (key === "exceptional" || key === "good") return "good";
  if (key === "normal") return "ok";
  if (key === "high") return "bad";
  return "unknown";
};

const normalizeProduceOcr = (value: string) =>
  value
    .replace(/\bbeteroba\b/gi, "beterraba")
    .replace(/\bbeterroba\b/gi, "beterraba")
    .replace(/\babeterraba\b/gi, "beterraba");

const displayProductName = (value: string) =>
  normalizeProduceOcr(value)
    .replace(/\bMamão Formoso\b/gi, "Mamão Formosa")
    .replace(
      /Arroz Riviera ou Patéko Riviera\s*\/\s*Patéko\s*5kg/gi,
      "Arroz Riviera ou Patéko 5kg",
    );

const safeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 90);

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const sortFlyerImages = (selected: File[]) =>
  [...selected].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR", {
      numeric: true,
      sensitivity: "base",
    }),
  );

async function sha256Files(selected: File[]) {
  if (selected.length === 1) return sha256(selected[0]);
  const parts = await Promise.all(
    selected.map(async (entry, index) =>
      `${index}:${entry.name}:${entry.size}:${await sha256(entry)}`,
    ),
  );
  const bytes = new TextEncoder().encode(parts.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default function FlyerPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View>("radar");
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [retailer, setRetailer] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [processedSource, setProcessedSource] = useState<ProcessedSource | null>(null);
  const [jobActioning, setJobActioning] = useState(false);
  const appliedJobRef = useRef<string | null>(null);

  const { data: products = [] } = useQuery<ProductForMatch[]>({
    queryKey: ["flyer-products", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("products")
        .select("id,name,category,brand,package_size,unit,stockable,image_url,image_source,prices(price,date,supermarket)")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: aliases = [] } = useQuery<any[]>({
    queryKey: ["product-aliases", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("product_aliases")
        .select("product_id,normalized_alias,retailer");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: previousOffers = [] } = useQuery<any[]>({
    queryKey: ["flyer-item-history", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyer_items")
        .select("flyer_id,product_id,normalized_price,base_unit,advertised_price,created_at")
        .not("product_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1500);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: flyerHistory = [] } = useQuery<any[]>({
    queryKey: ["flyers", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyers")
        .select("id,retailer,title,valid_from,valid_to,source_file_name,source_file_path,created_at,flyer_items(count)")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: selectedHistoryItems = [], isLoading: historyItemsLoading } = useQuery<any[]>({
    queryKey: ["flyer-history-items", selectedHistoryId],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyer_items")
        .select("id,product_id,raw_name,brand,package_quantity,package_unit,advertised_price,normalized_price,base_unit,club_advertised_price,excluded_types,included_types,purchase_limit,store_restrictions,offer_notes,source_page,image_url,image_source,image_confidence,image_match_status")
        .eq("flyer_id", selectedHistoryId)
        .order("source_page", { ascending: true })
        .order("raw_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedHistoryId,
    refetchInterval: (query) => {
      const rows = query.state.data as any[] | undefined;
      return rows?.some((item) => !item.image_source) ? 3000 : false;
    },
    refetchOnWindowFocus: true,
  });

  const { data: activeJob } = useQuery<FlyerImportJob | null>({
    queryKey: ["flyer-import-job", user?.id, activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const { data, error } = await db
        .from("flyer_import_jobs")
        .select("id,status,progress_current,progress_total,progress_label,source_file_path,source_file_name,mime_type,source_files,file_hash,page_count,retailer,valid_from,valid_to,result,missing_pages,warning_message,error_message,updated_at")
        .eq("id", activeJobId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!user && !!activeJobId,
    refetchInterval: (query) => {
      const status = (query.state.data as FlyerImportJob | null | undefined)?.status;
      return status && ["queued", "processing", "refining"].includes(status) ? 1500 : false;
    },
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const recoverImport = async () => {
      const saved = localStorage.getItem(IMPORT_JOB_KEY);
      if (saved) {
        if (!cancelled) {
          setActiveJobId(saved);
          setProgress({ current: 1, total: 1, label: "Recuperando importação…" });
        }
        return;
      }

      // Older builds removed the local job id as soon as analysis completed.
      // Recover a recent completed-but-not-saved import so a refresh does not
      // discard the review screen.
      const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data: latest, error: latestError } = await db
        .from("flyer_import_jobs")
        .select("id,file_hash,completed_at")
        .eq("status", "completed")
        .gte("completed_at", cutoff)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError || !latest || cancelled) return;

      let alreadySaved = false;
      if (latest.file_hash) {
        const { data: savedFlyer } = await db
          .from("flyers")
          .select("id")
          .eq("file_hash", latest.file_hash)
          .limit(1)
          .maybeSingle();
        alreadySaved = !!savedFlyer;
      }

      if (!alreadySaved && !cancelled) {
        localStorage.setItem(IMPORT_JOB_KEY, latest.id);
        setActiveJobId(latest.id);
        setProgress({ current: 1, total: 1, label: "Recuperando importação concluída…" });
      }
    };

    void recoverImport();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const analyzed = useMemo(
    () =>
      items
        .map((item) => {
          const product = item.productId ? productMap.get(item.productId) ?? null : null;
          const previous = item.productId
            ? previousOffers.filter((offer) => offer.product_id === item.productId)
            : [];
          return { ...item, product, verdict: evaluateFlyerOffer(item, product, previous) };
        })
        .sort(
          (a, b) =>
            rank[a.verdict.key] - rank[b.verdict.key] ||
            (a.verdict.deltaPct ?? 999) - (b.verdict.deltaPct ?? 999),
        ),
    [items, productMap, previousOffers],
  );

  const summary = useMemo(
    () => ({
      exceptional: analyzed.filter((item) => item.verdict.key === "exceptional").length,
      good: analyzed.filter((item) => item.verdict.key === "good").length,
      matched: analyzed.filter((item) => item.productId).length,
      unknown: analyzed.filter((item) => !item.productId || item.verdict.key === "unknown").length,
    }),
    [analyzed],
  );

  const historyAnalyzedItems = useMemo(
    () =>
      selectedHistoryItems.map((item) => {
        const product = item.product_id ? productMap.get(item.product_id) ?? null : null;
        const previous = item.product_id
          ? previousOffers.filter(
              (offer) =>
                offer.product_id === item.product_id &&
                offer.flyer_id !== selectedHistoryId,
            )
          : [];
        const candidate: FlyerCandidate = {
          rawName: item.raw_name,
          brand: item.brand ?? null,
          price: Number(item.advertised_price),
          packageInfo: inferPackage(item.raw_name),
          normalizedPrice:
            Number(item.normalized_price) || Number(item.advertised_price),
          baseUnit: (item.base_unit || "un") as "kg" | "l" | "un",
          clubPrice: Number(item.club_advertised_price) > 0,
          sourcePage: item.source_page || 1,
        };
        return {
          ...item,
          product,
          verdict: evaluateFlyerOffer(candidate, product, previous),
        };
      }),
    [selectedHistoryItems, productMap, previousOffers, selectedHistoryId],
  );

  const matchOne = (candidate: FlyerCandidate, retailerOverride?: string): ReviewItem => {
    const match = matchFlyerItem(
      candidate,
      products,
      aliases,
      retailerOverride ?? retailer,
    );
    return {
      ...candidate,
      localId: crypto.randomUUID(),
      productId: match.productId,
      matchConfidence: match.confidence,
      matchType: match.type,
    };
  };

  useEffect(() => {
    if (!activeJob) return;

    setProgress({
      current: Math.max(0, Number(activeJob.progress_current) || 0),
      total: Math.max(1, Number(activeJob.progress_total) || Number(activeJob.page_count) || 1),
      label: activeJob.progress_label || "Processando no servidor…",
    });

    if (["queued", "processing", "refining"].includes(activeJob.status)) {
      setProcessing(true);
      return;
    }

    if (activeJob.status === "failed") {
      setProcessing(false);
      localStorage.removeItem(IMPORT_JOB_KEY);
      if (appliedJobRef.current !== activeJob.id) {
        appliedJobRef.current = activeJob.id;
        toast({
          title: "Não consegui importar o tabloide",
          description: activeJob.error_message || "O processamento no servidor falhou.",
          variant: "destructive",
        });
      }
      return;
    }

    if (
      activeJob.status !== "completed" ||
      !activeJob.result ||
      appliedJobRef.current === activeJob.id
    ) {
      return;
    }

    try {
      const result = visionResponseToFlyerResult(
        activeJob.result,
        activeJob.page_count || 1,
      );
      const meta = extractFlyerMeta(result.metaText || result.textByPage.join("\n"));
      const detectedRetailer = result.retailer || activeJob.retailer || meta.retailer;
      const detectedValidFrom = result.validFrom || activeJob.valid_from || meta.validFrom;
      const detectedValidTo = result.validTo || activeJob.valid_to || meta.validTo;

      if (detectedRetailer && !retailer) setRetailer(detectedRetailer);
      if (detectedValidFrom && !validFrom) setValidFrom(detectedValidFrom);
      if (detectedValidTo && !validTo) setValidTo(detectedValidTo);
      setPageCount(result.pageCount);
      setProcessedSource({
        path: activeJob.source_file_path,
        fileHash: activeJob.file_hash,
        fileName: activeJob.source_file_name,
        mimeType: activeJob.mime_type,
        pageCount: result.pageCount,
        sourceFiles: Array.isArray(activeJob.source_files)
          ? activeJob.source_files
          : [],
      });

      const effectiveRetailer = detectedRetailer || retailer;
      const matched = result.candidates.map((candidate) => {
        try {
          return matchOne(candidate, effectiveRetailer);
        } catch {
          return {
            ...candidate,
            localId: crypto.randomUUID(),
            productId: null,
            matchConfidence: 0,
            matchType: "unmatched" as const,
          };
        }
      });

      appliedJobRef.current = activeJob.id;
      setItems(matched);
      setProcessing(false);
      setView("radar");
      // Keep the completed job id until the offers are actually saved. This makes
      // an analyzed flyer recoverable after a browser refresh or Android tab suspension.
      localStorage.setItem(IMPORT_JOB_KEY, activeJob.id);

      toast({
        title: `${result.candidates.length} ofertas importadas`,
        description:
          `${matched.filter((item) => item.productId).length} relacionadas ao seu histórico.` +
          (activeJob.warning_message ? ` ${activeJob.warning_message}` : ""),
      });
    } catch (error: any) {
      appliedJobRef.current = activeJob.id;
      setProcessing(false);
      localStorage.removeItem(IMPORT_JOB_KEY);
      toast({
        title: "Não consegui montar a leitura do tabloide",
        description: error?.message ?? "A análise terminou, mas o resultado não pôde ser carregado.",
        variant: "destructive",
      });
    }
  }, [
    activeJob,
    aliases,
    products,
    retailer,
    validFrom,
    validTo,
  ]);

  const activeJobStale =
    !!activeJob &&
    ["queued", "processing", "refining"].includes(activeJob.status) &&
    !!activeJob.updated_at &&
    Date.now() - new Date(activeJob.updated_at).getTime() > 4 * 60 * 1000;

  const retryActiveJob = async () => {
    if (!activeJobId || !activeJob) return;
    setJobActioning(true);
    setProcessing(true);
    appliedJobRef.current = null;

    try {
      const { error: resetError } = await db
        .from("flyer_import_jobs")
        .update({
          status: "queued",
          error_message: null,
          warning_message: null,
          completed_at: null,
          progress_label: "Retomando importação no servidor…",
        })
        .eq("id", activeJobId);
      if (resetError) throw resetError;

      localStorage.setItem(IMPORT_JOB_KEY, activeJobId);
      const { error: invokeError } = await supabase.functions.invoke(
        "process-flyer-job",
        { body: { job_id: activeJobId, mode: "resume" } },
      );
      if (invokeError) throw invokeError;

      setProgress({
        current: Math.max(0, Number(activeJob.progress_current) || 0),
        total: Math.max(1, Number(activeJob.progress_total) || Number(activeJob.page_count) || 1),
        label: "Importação retomada. Continuando da primeira página pendente…",
      });
      await queryClient.invalidateQueries({
        queryKey: ["flyer-import-job", user?.id, activeJobId],
      });
      toast({
        title: "Importação retomada",
        description: "O servidor vai continuar a partir da primeira página que ainda não foi concluída.",
      });
    } catch (error: any) {
      setProcessing(false);
      toast({
        title: "Não consegui retomar a importação",
        description: error?.message ?? "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setJobActioning(false);
    }
  };

  const cancelActiveJob = async () => {
    if (!activeJobId) return;
    setJobActioning(true);
    try {
      const { error } = await db
        .from("flyer_import_jobs")
        .update({
          status: "failed",
          progress_label: "Importação cancelada.",
          error_message: "Importação cancelada pelo usuário.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", activeJobId);
      if (error) throw error;

      localStorage.removeItem(IMPORT_JOB_KEY);
      setProcessing(false);
      await queryClient.invalidateQueries({
        queryKey: ["flyer-import-job", user?.id, activeJobId],
      });
    } catch (error: any) {
      toast({
        title: "Não consegui cancelar",
        description: error?.message ?? "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setJobActioning(false);
    }
  };

  const chooseAnotherFile = () => {
    localStorage.removeItem(IMPORT_JOB_KEY);
    setActiveJobId(null);
    setProcessing(false);
    setProgress({ current: 0, total: 0, label: "" });
    appliedJobRef.current = null;
    setTimeout(() => fileRef.current?.click(), 0);
  };

  const handleFileSelect = async (selectedFiles: File[]) => {
    const selected = sortFlyerImages(selectedFiles);
    const pdfs = selected.filter(
      (entry) => entry.type === "application/pdf" || entry.name.toLowerCase().endsWith(".pdf"),
    );
    const images = selected.filter((entry) => entry.type.startsWith("image/"));

    if (selected.length > 1 && (pdfs.length || images.length !== selected.length)) {
      toast({
        title: "Seleção incompatível",
        description: "Para várias páginas, selecione somente imagens PNG/JPG. PDF deve ser selecionado sozinho.",
        variant: "destructive",
      });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const primary = selected[0] ?? null;
    setFiles(selected);
    setFile(primary);
    setItems([]);
    setPageCount(selected.length > 1 ? selected.length : null);
    setProcessedSource(null);
    setActiveJobId(null);
    appliedJobRef.current = null;
    localStorage.removeItem(IMPORT_JOB_KEY);

    if (!primary) return;

    setRetailer("");
    setValidFrom("");
    setValidTo("");

    if (!user) return;

    try {
      const fileHash = await sha256Files(selected);
      const { data: knownFlyer, error } = await db
        .from("flyers")
        .select("retailer,valid_from,valid_to")
        .eq("file_hash", fileHash)
        .maybeSingle();

      if (error) throw error;
      if (!knownFlyer) return;

      setRetailer(knownFlyer.retailer ?? "");
      setValidFrom(knownFlyer.valid_from ?? "");
      setValidTo(knownFlyer.valid_to ?? "");

      toast({
        title: "Dados reconhecidos",
        description: "Mercado e validade foram preenchidos pelo histórico deste mesmo tabloide.",
      });
    } catch {
      // Metadata reuse is optional and must never block the flyer analysis.
    }
  };

  const moveSelectedPage = (from: number, to: number) => {
    setFiles((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setFile(next[0] ?? null);
      setPageCount(next.length || null);
      return next;
    });
  };

  const processFile = async () => {
    if (!file || !user) return;
    const selected = files.length ? files : [file];
    setProcessing(true);
    setItems([]);
    setProcessedSource(null);
    appliedJobRef.current = null;

    try {
      setProgress({ current: 1, total: 3, label: "Preparando arquivo…" });

      const multiImage = selected.length > 1;
      const [fileHash, detectedPages] = await Promise.all([
        sha256Files(selected),
        multiImage ? Promise.resolve(selected.length) : countFlyerPages(file),
      ]);
      setPageCount(detectedPages);

      const jobId = crypto.randomUUID();
      const sourceFiles: SourceFileEntry[] = [];

      setProgress({
        current: 2,
        total: 3,
        label: multiImage
          ? `Enviando ${selected.length} páginas para o servidor…`
          : "Enviando o tabloide para o servidor…",
      });

      for (let index = 0; index < selected.length; index += 1) {
        const source = selected[index];
        const pagePrefix = multiImage
          ? `page-${String(index + 1).padStart(3, "0")}-`
          : "";
        const path =
          `${user.id}/imports/${jobId}/${pagePrefix}${safeName(source.name || "tabloide")}`;

        const { error: uploadError } = await supabase.storage
          .from("flyers")
          .upload(path, source, {
            contentType: source.type || undefined,
            upsert: false,
          });
        if (uploadError) throw uploadError;

        sourceFiles.push({
          path,
          name: source.name || `pagina-${index + 1}`,
          mime_type: source.type || null,
          size: source.size,
        });
      }

      const primarySource = sourceFiles[0];
      const sourceFileName = multiImage
        ? `Tabloide · ${selected.length} imagens`
        : file.name || "tabloide";

      const { error: jobError } = await db.from("flyer_import_jobs").insert({
        id: jobId,
        user_id: user.id,
        source_file_path: primarySource.path,
        source_file_name: sourceFileName,
        mime_type: multiImage ? "image/multi" : file.type || null,
        source_files: sourceFiles,
        file_hash: fileHash,
        page_count: detectedPages,
        retailer: retailer.trim() || null,
        valid_from: validFrom || null,
        valid_to: validTo || null,
        status: "queued",
        progress_current: 0,
        progress_total: detectedPages,
        progress_label: "Arquivo recebido. Aguardando processamento…",
      });
      if (jobError) throw jobError;

      setActiveJobId(jobId);
      localStorage.setItem(IMPORT_JOB_KEY, jobId);
      setProgress({ current: 3, total: 3, label: "Importação iniciada no servidor…" });

      const { error: invokeError } = await supabase.functions.invoke("process-flyer-job", {
        body: { job_id: jobId, mode: "start" },
      });
      if (invokeError) {
        await db
          .from("flyer_import_jobs")
          .update({
            status: "failed",
            progress_label: "Não foi possível iniciar o processamento.",
            error_message: invokeError.message || "Falha ao chamar o servidor.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        throw invokeError;
      }

      setProgress({
        current: 1,
        total: detectedPages,
        label: multiImage
          ? `${selected.length} páginas enviadas. A IA continua no servidor.`
          : "Arquivo enviado. A IA continua no servidor; você pode trocar de tela.",
      });
    } catch (error: any) {
      setProcessing(false);
      setProgress({ current: 0, total: 0, label: "" });
      toast({
        title: "Não consegui iniciar a importação",
        description: error?.message ?? "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const recalc = (item: ReviewItem, rawName: string, price: number) => {
    const packageInfo = inferPackage(rawName);
    const normalized = normalizedUnitPrice(price, packageInfo);
    const candidate: FlyerCandidate = {
      rawName,
      brand: item.brand ?? null,
      price,
      packageInfo,
      normalizedPrice: normalized.normalizedPrice,
      baseUnit: normalized.baseUnit,
      clubPrice: item.clubPrice,
      sourcePage: item.sourcePage,
    };
    const match = matchFlyerItem(candidate, products, aliases, retailer);
    return {
      ...item,
      ...candidate,
      productId: match.productId,
      matchConfidence: match.confidence,
      matchType: match.type,
    } as ReviewItem;
  };

  const updateName = (id: string, value: string) =>
    setItems((rows) =>
      rows.map((item) => (item.localId === id ? recalc(item, value, item.price) : item)),
    );

  const updatePrice = (id: string, value: string) => {
    const price = Number(value.replace(",", "."));
    setItems((rows) =>
      rows.map((item) =>
        item.localId === id
          ? recalc(item, item.rawName, Number.isFinite(price) ? price : 0)
          : item,
      ),
    );
  };

  const chooseProduct = (id: string, productId: string) =>
    setItems((rows) =>
      rows.map((item) =>
        item.localId === id
          ? {
              ...item,
              productId: productId || null,
              matchConfidence: productId ? 1 : 0,
              matchType: productId ? "manual" : "unmatched",
            }
          : item,
      ),
    );

  const addManual = () =>
    setItems((rows) => [
      {
        rawName: "",
        price: 0,
        packageInfo: null,
        normalizedPrice: 0,
        baseUnit: "un",
        clubPrice: false,
        sourcePage: 1,
        localId: crypto.randomUUID(),
        productId: null,
        matchConfidence: 0,
        matchType: "unmatched",
      },
      ...rows,
    ]);

  const saveFlyer = async () => {
    if (!user || (!file && !processedSource) || !retailer.trim()) {
      toast({ title: "Complete os dados", description: "Informe o mercado e selecione o arquivo." });
      return;
    }

    const validItems = items.filter((item) => item.rawName.trim() && item.price > 0);
    if (!validItems.length) {
      toast({ title: "Nenhuma oferta válida", description: "Revise os itens antes de salvar." });
      return;
    }

    setSaving(true);
    try {
      const selected = files.length ? files : file ? [file] : [];
      const fileHash =
        processedSource?.fileHash ??
        (selected.length ? await sha256Files(selected) : null);
      if (!fileHash) throw new Error("Não foi possível identificar o arquivo importado.");
      const sourceMime =
        processedSource?.mimeType ??
        (selected.length > 1 ? "image/multi" : file?.type ?? "");
      const sourceFileName =
        processedSource?.fileName ??
        (selected.length > 1
          ? `Tabloide · ${selected.length} imagens`
          : file?.name ?? "tabloide");
      const sourceFiles = processedSource?.sourceFiles ?? [];
      const sourceType = sourceMime === "application/pdf" || sourceFileName.toLowerCase().endsWith(".pdf")
        ? "pdf"
        : "image";
      let sourcePath = processedSource?.path ?? null;

      const { data: duplicate, error: duplicateError } = await db
        .from("flyers")
        .select("id,source_file_path")
        .eq("file_hash", fileHash)
        .maybeSingle();
      if (duplicateError) throw duplicateError;

      let flyer: { id: string };
      let replacedExisting = false;

      if (duplicate) {
        // Same source file means this is a reprocessing of the same flyer, not a new
        // historical event. Replace the extracted offers so OCR/IA refinements can be
        // validated without forcing the user to delete the flyer manually.
        const { error: updateFlyerError } = await db
          .from("flyers")
          .update({
            retailer: retailer.trim(),
            title: `${retailer.trim()} · ${validFrom ? dateBr(validFrom) : "Ofertas"}`,
            valid_from: validFrom || null,
            valid_to: validTo || null,
            source_type: sourceType,
            source_file_name: sourceFileName,
            source_file_path: sourcePath ?? duplicate.source_file_path,
            source_files: sourceFiles,
            page_count: pageCount,
          })
          .eq("id", duplicate.id);
        if (updateFlyerError) throw updateFlyerError;

        const { error: clearItemsError } = await db
          .from("flyer_items")
          .delete()
          .eq("flyer_id", duplicate.id);
        if (clearItemsError) throw clearItemsError;

        flyer = { id: duplicate.id };
        replacedExisting = true;
      } else {
        if (!sourcePath) {
          if (!file) throw new Error("O arquivo original não está mais disponível.");
          sourcePath = `${user.id}/${Date.now()}-${safeName(sourceFileName)}`;
          const { error: uploadError } = await supabase.storage
            .from("flyers")
            .upload(sourcePath, file, { contentType: sourceMime || undefined, upsert: false });
          if (uploadError) throw uploadError;
        }

        const { data: insertedFlyer, error: flyerError } = await db
          .from("flyers")
          .insert({
            user_id: user.id,
            retailer: retailer.trim(),
            title: `${retailer.trim()} · ${validFrom ? dateBr(validFrom) : "Ofertas"}`,
            valid_from: validFrom || null,
            valid_to: validTo || null,
            source_type: sourceType,
            source_file_name: sourceFileName,
            source_file_path: sourcePath,
            source_files: sourceFiles,
            file_hash: fileHash,
            page_count: pageCount,
          })
          .select("id")
          .single();
        if (flyerError) throw flyerError;
        flyer = insertedFlyer;
      }

      const { error: itemsError } = await db.from("flyer_items").insert(
        validItems.map((item) => {
          const rich = item as ReviewItem & {
            brand?: string | null;
            clubAdvertisedPrice?: number | null;
            includedTypes?: string[];
            excludedTypes?: string[];
            storeRestrictions?: string[];
            purchaseLimit?: string | null;
            offerNotes?: string[];
            extractionConfidence?: number;
            priceBasisQuantity?: number;
            priceBasisUnit?: string;
          };
          return {
            flyer_id: flyer.id,
            user_id: user.id,
            raw_name: item.rawName.trim(),
            normalized_name: normalizeSearchText(item.rawName),
            brand: rich.brand ?? null,
            package_quantity: item.packageInfo?.quantity ?? null,
            package_unit: item.packageInfo?.unit ?? null,
            advertised_price: item.price,
            base_unit: item.baseUnit,
            normalized_price: item.normalizedPrice,
            club_price: item.clubPrice,
            club_advertised_price: rich.clubAdvertisedPrice ?? null,
            included_types: rich.includedTypes ?? [],
            excluded_types: rich.excludedTypes ?? [],
            store_restrictions: rich.storeRestrictions ?? [],
            purchase_limit: rich.purchaseLimit ?? null,
            offer_notes: rich.offerNotes ?? [],
            extraction_confidence: rich.extractionConfidence ?? null,
            price_basis_quantity: rich.priceBasisQuantity ?? 1,
            price_basis_unit: rich.priceBasisUnit ?? "un",
            image_bbox:
              rich.imageBox &&
              Number(rich.imageBoxConfidence) >= 0.8
                ? rich.imageBox
                : null,
            image_bbox_confidence:
              rich.imageBox && Number(rich.imageBoxConfidence) >= 0.8
                ? Number(rich.imageBoxConfidence)
                : null,
            product_id: item.productId,
            match_confidence: item.matchConfidence,
            match_type: item.matchType,
            source_page: item.sourcePage,
          };
        }),
      );
      if (itemsError) throw itemsError;

      const aliasRows = validItems.filter(
        (item) => item.productId && (item.matchType === "manual" || item.matchConfidence >= 0.9),
      );
      for (const item of aliasRows) {
        const normalizedAlias = normalizeSearchText(item.rawName);
        const { data: existing } = await db
          .from("product_aliases")
          .select("id")
          .eq("user_id", user.id)
          .eq("normalized_alias", normalizedAlias)
          .eq("retailer", retailer.trim())
          .maybeSingle();
        if (!existing) {
          await db.from("product_aliases").insert({
            user_id: user.id,
            product_id: item.productId,
            alias: item.rawName.trim(),
            normalized_alias: normalizedAlias,
            retailer: retailer.trim(),
          });
        }
      }

      // Resolve a reusable product image from the normalized name/brand/package.
      // If no trustworthy image exists, the card keeps a category fallback icon.
      void supabase.functions.invoke("resolve-flyer-images", {
        body: { flyer_id: flyer.id },
      }).catch(() => {});

      await queryClient.invalidateQueries({ queryKey: ["flyers"] });
      await queryClient.invalidateQueries({ queryKey: ["flyer-item-history"] });
      await queryClient.invalidateQueries({ queryKey: ["product-aliases"] });

      toast({
        title: replacedExisting ? "Tabloide reprocessado" : "Preços ofertados salvos",
        description: replacedExisting
          ? `${validItems.length} ofertas substituíram a leitura anterior desse mesmo arquivo.`
          : `${validItems.length} ofertas agora fazem parte do histórico do Radar 360.`,
      });
      setFile(null);
      setItems([]);
      setPageCount(null);
      setProcessedSource(null);
      setActiveJobId(null);
      appliedJobRef.current = null;
      localStorage.removeItem(IMPORT_JOB_KEY);
      setView("history");
    } catch (error: any) {
      toast({
        title: "Erro ao salvar ofertas",
        description: error?.message ?? "Não foi possível concluir.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container mx-auto w-full max-w-3xl">
      <header className="mb-3 flex items-start justify-between gap-3 sm:mb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary sm:text-xs">Radar 360</p>
          <h1 className="mt-0.5 text-[clamp(1.45rem,6vw,2rem)] font-extrabold leading-tight tracking-tight sm:mt-1">
            Base de ofertas
          </h1>
          <p className="mt-1 max-w-xl text-xs leading-snug text-muted-foreground sm:text-sm">
            Importe, revise e mantenha os tabloides que alimentam o Preço 360.
          </p>
        </div>
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary sm:rounded-2xl sm:p-3">
          <Radar className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
      </header>

      <div className="mb-2.5 grid grid-cols-3 gap-1.5 rounded-xl bg-muted p-1 sm:mb-3 sm:gap-2">
        {([
          ["radar", "Revisão", Sparkles],
          ["import", "Importar", Upload],
          ["history", "Histórico", History],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold sm:h-10 ${
              view === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        className="mb-3 h-10 w-full justify-between border-primary/25 bg-primary/5 sm:mb-4 sm:h-11"
        onClick={() => navigate("/offers/basket")}
      >
        <span className="flex items-center gap-2">
          <ShoppingBasket className="h-4 w-4 text-primary" />
          <span className="text-left">
            <span className="block text-sm font-bold">Cesta 360 · Comparar supermercados</span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              Monte sua lista e veja onde a compra toda vale mais a pena
            </span>
          </span>
        </span>
        <span className="text-primary">›</span>
      </Button>

      {view === "import" && (
        <div className="space-y-3">
          <Card className="border-primary/20">
            <CardContent className="p-3.5 sm:p-5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={`flex w-full rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 text-center ${
                  file
                    ? "flex-row items-center gap-3 px-3 py-3 text-left sm:flex-col sm:px-5 sm:py-6 sm:text-center"
                    : "flex-col items-center px-5 py-6 sm:py-8"
                }`}
              >
                <div className={`${file ? "mb-0 shrink-0" : "mb-3"} rounded-xl bg-primary/15 p-2.5 text-primary sm:rounded-2xl sm:p-3`}>
                  {file?.type === "application/pdf" ? (
                    <FileText className="h-6 w-6 sm:h-7 sm:w-7" />
                  ) : (
                    <FileImage className="h-6 w-6 sm:h-7 sm:w-7" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className={`${file ? "truncate" : ""} font-bold`}>
                    {files.length > 1
                      ? `${files.length} imagens selecionadas`
                      : file
                        ? file.name
                        : "Escolher PDF ou imagens do tabloide"}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:mt-1 sm:text-xs">
                    {files.length > 1
                      ? "As imagens serão tratadas como páginas de um único tabloide."
                      : "O arquivo original fica guardado como evidência do preço ofertado."}
                  </p>
                </div>
              </button>

              <input
                ref={fileRef}
                className="hidden"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) =>
                  void handleFileSelect(Array.from(event.target.files ?? []))
                }
              />

              {files.length > 1 && (
                <div className="mt-3 rounded-xl border bg-background/60 p-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold">Ordem das páginas</p>
                    <p className="text-[10px] text-muted-foreground">
                      {files.length} imagens
                    </p>
                  </div>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto">
                    {files.map((entry, index) => (
                      <div
                        key={`${entry.name}-${entry.lastModified}-${index}`}
                        className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-extrabold text-primary">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                          {entry.name}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          disabled={index === 0 || processing}
                          onClick={() => moveSelectedPage(index, index - 1)}
                          aria-label="Mover página para cima"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          disabled={index === files.length - 1 || processing}
                          onClick={() => moveSelectedPage(index, index + 1)}
                          aria-label="Mover página para baixo"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 sm:mt-4">
                <p className="mb-1.5 text-[11px] leading-snug text-muted-foreground sm:mb-2 sm:text-xs">
                  Opcional — a IA tenta identificar mercado e validade no tabloide.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="mb-1 block text-[11px] font-semibold text-muted-foreground sm:text-xs">
                      Mercado <span className="font-normal">(opcional)</span>
                    </label>
                    <Input
                      className="h-10 sm:h-10"
                      value={retailer}
                      onChange={(event) => setRetailer(event.target.value)}
                      placeholder="A IA tenta identificar"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-muted-foreground sm:text-xs">
                      Válido de <span className="hidden font-normal sm:inline">(opcional)</span>
                    </label>
                    <Input
                      className="h-10 px-2 text-xs sm:px-3 sm:text-sm"
                      type="date"
                      value={validFrom}
                      onChange={(event) => setValidFrom(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-muted-foreground sm:text-xs">
                      Até <span className="hidden font-normal sm:inline">(opcional)</span>
                    </label>
                    <Input
                      className="h-10 px-2 text-xs sm:px-3 sm:text-sm"
                      type="date"
                      value={validTo}
                      onChange={(event) => setValidTo(event.target.value)}
                    />
                  </div>
                </div>
              </div>

              {processing && (
                <div className="mt-4 rounded-xl bg-muted p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {progress.label || "Analisando…"}
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${progress.total ? Math.max(8, (progress.current / progress.total) * 100) : 15}%`,
                      }}
                    />
                  </div>
                  {activeJobId && (
                    <>
                      {activeJob?.source_file_name && (
                        <p className="mt-2 truncate text-[11px] font-semibold text-foreground">
                          Arquivo: {activeJob.source_file_name}
                        </p>
                      )}
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        O arquivo já está no servidor. Você pode trocar de aplicativo ou bloquear a tela;
                        ao voltar, o Preço 360 consulta o andamento novamente.
                      </p>
                      {activeJobStale && (
                        <p className="mt-2 text-[11px] font-semibold text-amber-400">
                          Essa etapa está demorando mais que o esperado. Você pode reiniciar sem reenviar o PDF.
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        {activeJobStale && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            disabled={jobActioning}
                            onClick={() => void retryActiveJob()}
                          >
                            {jobActioning ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            Reiniciar processamento
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="flex-1 text-muted-foreground"
                          disabled={jobActioning}
                          onClick={() => void cancelActiveJob()}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeJob?.status === "failed" && !processing && (
                <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-bold text-destructive">
                    A importação foi interrompida
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {activeJob.error_message || "O servidor não conseguiu concluir a leitura."}
                  </p>
                  {activeJob.source_file_name && (
                    <p className="mt-2 truncate text-[11px] font-semibold text-foreground">
                      Arquivo: {activeJob.source_file_name}
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={jobActioning}
                      onClick={() => void retryActiveJob()}
                    >
                      {jobActioning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Tentar novamente
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={jobActioning}
                      onClick={chooseAnotherFile}
                    >
                      Escolher outro arquivo
                    </Button>
                  </div>
                </div>
              )}

              <Button className="mt-3 h-10 w-full sm:mt-4 sm:h-11" disabled={!file || processing} onClick={() => void processFile()}>
                {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {processing ? "Importando no servidor…" : "Analisar tabloide"}
              </Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
            <div className="rounded-xl border bg-card p-3">
              <BadgeCheck className="mx-auto mb-1 h-4 w-4 text-primary" />
              <b className="block text-foreground">Normaliza</b>g, kg, ml e L
            </div>
            <div className="rounded-xl border bg-card p-3">
              <Tags className="mx-auto mb-1 h-4 w-4 text-primary" />
              <b className="block text-foreground">Relaciona</b>nome cheio e abreviado
            </div>
            <div className="rounded-xl border bg-card p-3">
              <History className="mx-auto mb-1 h-4 w-4 text-primary" />
              <b className="block text-foreground">Aprende</b>a cada importação
            </div>
          </div>
        </div>
      )}

      {view === "radar" && (
        <div className="space-y-4">
          {!items.length ? (
            <Card className="border-dashed">
              <CardContent className="p-7 text-center">
                <Radar className="mx-auto h-9 w-9 text-primary" />
                <h2 className="mt-3 text-lg font-bold">Seu radar de mercado começa aqui</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Importe um tabloide para comparar preço ofertado com o que você já pagou.
                </p>
                <Button className="mt-4" onClick={() => setView("import")}>
                  <Upload className="mr-2 h-4 w-4" />Importar tabloide
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Metric label="Preço raro" value={summary.exceptional} className="text-emerald-600" />
                <Metric label="Vale a pena" value={summary.good} className="text-primary" />
                <Metric label="Relacionados" value={summary.matched} />
                <Metric label="Novos" value={summary.unknown} />
              </div>

              {summary.exceptional + summary.good > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h2 className="font-bold">Compre primeiro</h2>
                  </div>
                  <div className="space-y-2">
                    {analyzed
                      .filter((item) => ["exceptional", "good"].includes(item.verdict.key))
                      .slice(0, 10)
                      .map((item) => (
                        <Card key={item.localId} className={cardTone[item.verdict.key]}>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-bold">{item.rawName}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {item.product?.name ? `↳ ${item.product.name}` : "Sem correspondência confirmada"}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="font-extrabold">
                                  {offerPriceWithReference(item.price, item.normalizedPrice, item.baseUnit)}
                                </p>
                                {historicalReferenceLabel(item.verdict.referencePrice, item.baseUnit) ? (
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    Referência histórica: {historicalReferenceLabel(item.verdict.referencePrice, item.baseUnit)}
                                  </p>
                                ) : (
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    Sem referência histórica comparável
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                              <span className="rounded-full bg-background/80 px-2.5 py-1 text-xs font-bold text-primary">
                                {item.verdict.label}
                              </span>
                              <span className="text-xs text-muted-foreground">confiança {item.verdict.confidence}</span>
                            </div>
                            <p className="mt-2 text-xs text-foreground/75">{item.verdict.message}</p>
                          </CardContent>
                        </Card>
                      ))}
                  </div>
                </div>
              )}

              <details className="group rounded-xl border bg-card" open={summary.exceptional + summary.good === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between p-4 font-semibold">
                  Revisar {items.length} ofertas
                  <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                </summary>
                <div className="space-y-3 border-t p-3">
                  <Button size="sm" variant="outline" onClick={addManual}>
                    <Plus className="mr-1.5 h-4 w-4" />Adicionar oferta
                  </Button>

                  {analyzed.map((item) => (
                    <div key={item.localId} className={`rounded-xl border p-3 ${cardTone[item.verdict.key]}`}>
                      <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                        <Input value={item.rawName} placeholder="Nome do produto" onChange={(event) => updateName(item.localId, event.target.value)} />
                        <div className="flex gap-2">
                          <Input
                            inputMode="decimal"
                            value={item.price ? String(item.price).replace(".", ",") : ""}
                            placeholder="Preço ofertado"
                            onChange={(event) => updatePrice(item.localId, event.target.value)}
                          />
                          <button
                            onClick={() => setItems((rows) => rows.filter((row) => row.localId !== item.localId))}
                            className="rounded-lg border px-2 text-muted-foreground"
                            aria-label="Excluir oferta"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <select
                          className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
                          value={item.productId ?? ""}
                          onChange={(event) => chooseProduct(item.localId, event.target.value)}
                        >
                          <option value="">Sem correspondência</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>{product.name}</option>
                          ))}
                        </select>
                        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {item.baseUnit === "un"
                              ? `Preço unitário: ${brl(item.price)}`
                              : `Equivalente: ${formatNormalizedPrice(item.normalizedPrice || item.price, item.baseUnit)}`}
                          </span>
                          {historicalReferenceLabel(item.verdict.referencePrice, item.baseUnit) ? (
                            <>
                              <span>·</span>
                              <span>
                                Referência: {historicalReferenceLabel(item.verdict.referencePrice, item.baseUnit)}
                              </span>
                            </>
                          ) : null}
                          <span>·</span>
                          <span>{item.matchType === "manual" ? "confirmado" : `${Math.round(item.matchConfidence * 100)}% match`}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <div className="rounded-xl border bg-card p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Store className="h-3.5 w-3.5" />Mercado</label>
                    <Input value={retailer} onChange={(event) => setRetailer(event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />Início</label>
                    <Input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />Fim</label>
                    <Input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} />
                  </div>
                </div>
                <Button
                  className="mt-3 h-11 w-full"
                  disabled={saving || (!file && !processedSource)}
                  onClick={() => void saveFlyer()}
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {saving ? "Salvando histórico…" : "Salvar preços ofertados"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {view === "history" && (
        <div className="space-y-3">
          {!flyerHistory.length ? (
            <Card className="border-dashed">
              <CardContent className="p-7 text-center">
                <History className="mx-auto h-8 w-8 text-primary" />
                <p className="mt-3 font-bold">Nenhuma oferta salva ainda</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Os preços ofertados ficam aqui mesmo quando você não compra o produto.
                </p>
              </CardContent>
            </Card>
          ) : (
            flyerHistory.map((flyer) => {
              const open = selectedHistoryId === flyer.id;
              return (
                <Card key={flyer.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><FileText className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{flyer.retailer}</p>
                        <p className="text-xs text-muted-foreground">
                          {dateBr(flyer.valid_from)} → {dateBr(flyer.valid_to)} · {flyer.flyer_items?.[0]?.count ?? 0} ofertas
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {flyer.source_file_name || "Ofertas"} · {dateBr(flyer.created_at)}
                        </p>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant={open ? "secondary" : "default"}
                      className="mt-3 h-10 w-full"
                      onClick={() => setSelectedHistoryId(open ? null : flyer.id)}
                    >
                      {open ? "Ocultar ofertas" : `Ver ${flyer.flyer_items?.[0]?.count ?? 0} ofertas importadas`}
                      <ChevronDown className={`ml-2 h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
                    </Button>
                  </CardContent>

                  {open && (
                    <div className="border-t p-3">
                      {historyItemsLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] font-bold">
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Vale a pena
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-400">
                              <MinusCircle className="h-3 w-3" /> Preço ok
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-400">
                              <XCircle className="h-3 w-3" /> Não vale
                            </span>
                          </div>

                          {historyAnalyzedItems.map((item) => {
                            const tone = visualTone(item.verdict.key);
                            return (
                              <div
                                key={item.id}
                                className="rounded-xl border border-white/10 bg-background/70 p-3 shadow-sm"
                              >
                                <div className="flex gap-3">
                                  <ProductThumb
                                    name={displayProductName(item.raw_name)}
                                    category={item.product?.category}
                                    imageUrl={item.image_url || item.product?.image_url}
                                  />

                                  <div className="min-w-0 flex-1">
                                    <p className="font-bold leading-snug">
                                      {displayProductName(item.raw_name)}
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                      <p className="font-extrabold">
                                        {offerPriceWithReference(
                                          Number(item.advertised_price),
                                          Number(item.normalized_price) || Number(item.advertised_price),
                                          item.base_unit || "un",
                                        )}
                                      </p>
                                      {item.club_advertised_price ? (
                                        <p className="text-[11px] font-semibold text-primary">
                                          Clube {brl(Number(item.club_advertised_price))}
                                        </p>
                                      ) : null}
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                      Página {item.source_page ?? "—"}
                                    </p>

                                    <div className="mt-2 flex items-end justify-between gap-2">
                                      <VerdictDelta
                                        tone={tone}
                                        deltaPct={item.verdict.deltaPct}
                                        reference={historicalReferenceLabel(
                                          item.verdict.referencePrice,
                                          item.base_unit || "un",
                                        )}
                                      />
                                      <VerdictBadge tone={tone} />
                                    </div>

                                    {Array.isArray(item.excluded_types) && item.excluded_types.length > 0 ? (
                                      <p className="mt-2 text-xs text-muted-foreground">
                                        Exceto: {item.excluded_types.join(", ")}
                                      </p>
                                    ) : null}
                                    {Array.isArray(item.included_types) && item.included_types.length > 0 ? (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        Tipos: {item.included_types.join(", ")}
                                      </p>
                                    ) : null}
                                    {item.purchase_limit ? (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        Limite: {item.purchase_limit}
                                      </p>
                                    ) : null}
                                    {Array.isArray(item.store_restrictions) && item.store_restrictions.length > 0 ? (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        Lojas: {item.store_restrictions.join(", ")}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ProductVisualIcon({
  visual,
}: {
  visual: string | null;
}) {
  if (visual === "__beet__") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-9 w-9">
        <path d="M24 16c-8.2 0-14 5.7-14 13 0 8.8 9.1 14.1 14 17 4.9-2.9 14-8.2 14-17 0-7.3-5.8-13-14-13Z" fill="#8b3f8f" />
        <path d="M23 17c-5.5-7-3.9-12.2 1.1-15.2 2.3 5.2 2.1 10.2-1.1 15.2Z" fill="#4f9d55" />
        <path d="M27 17c2.3-7.1 7.1-9.6 12.6-8-2.3 5.3-6.4 8.1-12.6 8Z" fill="#68b66b" />
      </svg>
    );
  }

  const simple = (children: React.ReactNode) => (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-9 w-9">
      {children}
    </svg>
  );

  if (visual === "__mayo__") return simple(<>
    <path d="M13 12h22l-2 30H15L13 12Z" fill="#f6f0cf" />
    <path d="M12 8h24v7H12V8Z" fill="#f2c84b" />
    <rect x="17" y="20" width="14" height="12" rx="3" fill="#fff" />
  </>);
  if (visual === "__papaya__") return simple(<>
    <path d="M10 26c2-10 12-18 23-15 8 2 9 10 4 17-7 10-21 11-27 4-2-2-2-4 0-6Z" fill="#f39a32" />
    <path d="M15 27c4-7 11-10 18-9-2 7-8 12-17 13Z" fill="#ffbd4a" />
    <circle cx="26" cy="24" r="1.7" fill="#3e2c22" /><circle cx="30" cy="22" r="1.7" fill="#3e2c22" />
  </>);
  if (visual === "__mouthwash__") return simple(<>
    <rect x="18" y="4" width="12" height="7" rx="2" fill="#d7e8f7" />
    <rect x="13" y="10" width="22" height="33" rx="5" fill="#38a9d6" />
    <rect x="17" y="22" width="14" height="10" rx="2" fill="#eef7fb" />
  </>);
  if (visual === "__proteinbar__") return simple(<>
    <rect x="7" y="14" width="34" height="20" rx="5" fill="#713d24" />
    <rect x="11" y="18" width="26" height="12" rx="3" fill="#b76b3f" />
    <path d="M15 21h18" stroke="#f5d8a8" strokeWidth="3" strokeLinecap="round" />
  </>);
  if (visual === "__yogurt__") return simple(<>
    <path d="M14 14h20l-2.5 26h-15L14 14Z" fill="#f5f7fb" />
    <ellipse cx="24" cy="14" rx="11" ry="4" fill="#dce7f2" />
    <rect x="17" y="21" width="14" height="10" rx="3" fill="#f09ab3" />
  </>);
  if (visual === "__fishfillet__") return simple(<>
    <path d="M8 25c7-10 21-13 31-5-4 12-20 18-31 9l-3 4v-12l3 4Z" fill="#8ecae6" />
    <path d="M15 25c7-5 14-6 20-3-4 6-12 9-20 6Z" fill="#e8f5fb" />
  </>);
  if (visual === "__papertowel__") return simple(<>
    <ellipse cx="24" cy="9" rx="11" ry="4" fill="#f5f5f5" />
    <rect x="13" y="9" width="22" height="31" rx="4" fill="#fff" />
    <ellipse cx="24" cy="40" rx="11" ry="4" fill="#e7e7e7" />
    <ellipse cx="24" cy="9" rx="4" ry="2" fill="#b9a98f" />
  </>);
  if (visual === "__soda__") return simple(<>
    <path d="M18 5h12v7l3 5v25H15V17l3-5V5Z" fill="#d94b4b" />
    <rect x="17" y="21" width="14" height="10" rx="2" fill="#fff" />
    <path d="M20 26h8" stroke="#d94b4b" strokeWidth="2" />
  </>);
  if (visual === "__dolcegusto__") return simple(<>
    <path d="M10 16c2-7 8-11 14-11s12 4 14 11l-4 22H14L10 16Z" fill="#5c3b2e" />
    <ellipse cx="24" cy="16" rx="14" ry="7" fill="#2f211b" />
    <ellipse cx="24" cy="16" rx="9" ry="4" fill="#8c684f" />
  </>);
  if (visual === "__toddynho__") return simple(<>
    <rect x="12" y="7" width="24" height="34" rx="3" fill="#7b3f20" />
    <rect x="16" y="14" width="16" height="15" rx="2" fill="#f2d39a" />
    <path d="M31 7l6-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
  </>);
  if (visual === "__flourbag__") return simple(<>
    <path d="M12 8h24l-2 34H14L12 8Z" fill="#f4e6c8" />
    <rect x="16" y="17" width="16" height="13" rx="2" fill="#fff" />
    <path d="M20 26l4-8 4 8" stroke="#c79a4a" strokeWidth="2" />
  </>);
  if (visual === "__ketchup__") return simple(<>
    <path d="M18 6h12v7l4 8-3 21H17l-3-21 4-8V6Z" fill="#d92727" />
    <rect x="17" y="23" width="14" height="8" rx="2" fill="#fff" />
  </>);
  if (visual === "__bbq__") return simple(<>
    <path d="M17 6h14v5l4 7-4 24H17l-4-24 4-7V6Z" fill="#6f351e" />
    <rect x="16" y="21" width="16" height="10" rx="2" fill="#f5d7a1" />
    <text x="24" y="28" textAnchor="middle" fontSize="6" fontWeight="700" fill="#5a2b18">BBQ</text>
  </>);
  if (visual === "__tomatosauce__") return simple(<>
    <path d="M12 8h24l-3 32H15L12 8Z" fill="#d73b32" />
    <rect x="16" y="17" width="16" height="14" rx="3" fill="#fff" />
    <circle cx="24" cy="24" r="5" fill="#e9453b" />
  </>);
  if (visual === "__sweetpotato__") return simple(<>
    <path d="M8 29c4-13 18-21 31-11 2 11-9 20-23 20-7 0-11-4-8-9Z" fill="#a43d78" />
    <path d="M14 29c5-6 12-10 19-9-2 6-9 12-17 13Z" fill="#f3c050" />
  </>);
  if (visual === "__peas__") return simple(<>
    <path d="M7 27c8-13 25-15 35-5-8 14-25 17-35 5Z" fill="#61a744" />
    {[14,20,26,32].map((x)=><circle key={x} cx={x} cy="26" r="4" fill="#9bd36a" />)}
  </>);
  if (visual === "__vegetablemix__") return simple(<>
    <circle cx="15" cy="17" r="6" fill="#ef8c32" /><circle cx="29" cy="16" r="6" fill="#77b255" />
    <rect x="13" y="27" width="8" height="13" rx="3" fill="#e8b04a" />
    <circle cx="31" cy="31" r="5" fill="#7bbd50" /><circle cx="38" cy="35" r="4" fill="#8bd05d" />
  </>);
  if (visual === "__greengrapes__") return simple(<>
    {[20,27,34,16,24,31,21,28].map((x,i)=><circle key={i} cx={x} cy={18+i*2.4} r="5" fill={i%2?"#a8cf45":"#8fbd35"} />)}
    <path d="M25 10c5-6 10-7 15-4-3 5-8 8-15 8Z" fill="#4d9b45" />
  </>);
  if (visual === "__cashew__") return simple(<>
    <path d="M12 23c3-11 15-16 24-9 7 6 4 17-5 22-9 5-22 0-19-13Z" fill="#e7a23b" />
    <path d="M29 34c4 0 8 3 8 7-5 3-11 0-11-5 0-1 1-2 3-2Z" fill="#8a5b35" />
  </>);
  if (visual === "__melon__") return simple(<>
    <circle cx="24" cy="25" r="16" fill="#c8d96b" />
    <path d="M24 9v32M14 13c7 8 7 17 0 25M34 13c-7 8-7 17 0 25" stroke="#8a9e4e" strokeWidth="2" fill="none" />
  </>);
  if (visual === "__baconslices__") return simple(<>
    <path d="M7 15c8-5 14 4 22-1 5-3 9-1 12 2l-4 8c-7-5-13 3-21 0-5-2-8-1-12 1Z" fill="#e4776f" />
    <path d="M8 29c8-5 14 4 22-1 5-3 9-1 12 2l-4 8c-7-5-13 3-21 0-5-2-8-1-12 1Z" fill="#f09b8f" />
  </>);
  if (visual === "__baconchunk__") return simple(<>
    <path d="M8 17l24-8 9 12-24 18L7 31Z" fill="#db6e63" />
    <path d="M12 20l22-7 3 4-22 9Z" fill="#f1b09d" />
  </>);
  if (visual === "__porkribs__") return simple(<>
    <path d="M7 29c5-12 21-20 34-8-3 13-19 20-31 13Z" fill="#df8f8c" />
    <path d="M15 19l5 16M22 16l5 17M29 16l5 14" stroke="#f7ddd3" strokeWidth="3" />
  </>);
  if (visual === "__jerkedbeef__") return simple(<>
    <rect x="8" y="12" width="14" height="13" rx="4" fill="#8e4e2d" />
    <rect x="24" y="9" width="16" height="14" rx="4" fill="#9d5a35" />
    <rect x="15" y="27" width="18" height="13" rx="4" fill="#7c4328" />
  </>);
  if (visual === "__calabresa__") return simple(<>
    <path d="M8 28c8-15 24-17 33-4-6 10-16 15-28 12" stroke="#b84b3d" strokeWidth="8" strokeLinecap="round" fill="none" />
    <path d="M12 30c8-10 18-11 25-4" stroke="#e17b63" strokeWidth="2" fill="none" />
  </>);
  if (visual === "__mousse__") return simple(<>
    <path d="M11 18h26l-4 23H15L11 18Z" fill="#f2e7dc" />
    <path d="M14 18c3-10 17-12 20 0Z" fill="#69402f" />
    <path d="M18 16c2-5 10-6 13 0Z" fill="#8a5a44" />
  </>);
  if (visual === "__supplement__") return simple(<>
    <ellipse cx="24" cy="10" rx="13" ry="5" fill="#252a31" />
    <path d="M11 10h26l-2 31H13L11 10Z" fill="#3d4652" />
    <rect x="15" y="19" width="18" height="12" rx="3" fill="#eef1f5" />
    <path d="M18 25h12" stroke="#3d4652" strokeWidth="2.5" strokeLinecap="round" />
  </>);
  if (visual === "__sugarbag__") return simple(<>
    <path d="M13 8h22l3 33H10L13 8Z" fill="#f7f4e8" />
    <path d="M15 12h18" stroke="#d9caa1" strokeWidth="2" />
    <rect x="15" y="19" width="18" height="13" rx="3" fill="#fff" />
    <circle cx="24" cy="25.5" r="4" fill="#d8e9f5" />
  </>);
  if (visual === "__milkpowder__") return simple(<>
    <rect x="11" y="8" width="26" height="33" rx="5" fill="#f2f4f7" />
    <rect x="14" y="14" width="20" height="16" rx="3" fill="#d7e8ff" />
    <path d="M19 25c4-7 8-7 12 0" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" />
  </>);
  if (visual === "__plantmilk__") return simple(<>
    <path d="M13 8h19l4 6v28H13V8Z" fill="#edf3e6" />
    <path d="M32 8v7h4" fill="#d1e5c3" />
    <path d="M19 27c5-9 10-10 14-5-3 7-8 10-14 5Z" fill="#6fa95e" />
  </>);
  if (visual === "__wrap__") return simple(<>
    <rect x="8" y="13" width="32" height="22" rx="4" fill="#cbd2d9" />
    <ellipse cx="12" cy="24" rx="4" ry="9" fill="#eef1f4" />
    <path d="M16 17h20M16 22h20M16 27h20M16 32h20" stroke="#aeb7c1" strokeWidth="1.5" />
  </>);
  if (visual === "__sparkling__") return simple(<>
    <path d="M18 6h12v7l3 5v24H15V18l3-5V6Z" fill="#7fc8e8" />
    <circle cx="21" cy="25" r="2" fill="#fff" /><circle cx="27" cy="20" r="1.6" fill="#fff" /><circle cx="29" cy="30" r="2.2" fill="#fff" />
  </>);
  if (visual === "__tapioca__") return simple(<>
    <path d="M8 22h32c-1 12-7 19-16 19S9 34 8 22Z" fill="#f1e4c8" />
    <ellipse cx="24" cy="22" rx="16" ry="6" fill="#fafafa" />
    <circle cx="19" cy="21" r="2" fill="#e7e7e7" /><circle cx="26" cy="23" r="2" fill="#e7e7e7" /><circle cx="31" cy="20" r="1.5" fill="#e7e7e7" />
  </>);
  if (visual === "__baking__") return simple(<>
    <rect x="12" y="9" width="24" height="32" rx="4" fill="#f5efe6" />
    <rect x="16" y="17" width="16" height="13" rx="3" fill="#fff" />
    <path d="M20 28c1-6 7-6 8 0" stroke="#d8a85b" strokeWidth="2.5" fill="none" />
  </>);
  if (visual === "__mustard__") return simple(<>
    <path d="M18 6h12v7l4 8-3 21H17l-3-21 4-8V6Z" fill="#e4b927" />
    <rect x="17" y="23" width="14" height="8" rx="2" fill="#fff7cf" />
  </>);
  if (visual === "__onionrings__") return simple(<>
    <ellipse cx="17" cy="23" rx="9" ry="7" fill="none" stroke="#d8a348" strokeWidth="5" />
    <ellipse cx="31" cy="27" rx="9" ry="7" fill="none" stroke="#e3b45d" strokeWidth="5" />
  </>);
  if (visual === "__potatosnack__") return simple(<>
    <path d="M11 8h26l-3 34H14L11 8Z" fill="#d6b246" />
    <path d="M16 18h16v14H16Z" fill="#f6e0a0" />
    <path d="M19 28c3-7 7-9 11-6-2 6-6 9-11 6Z" fill="#c79631" />
  </>);
  if (visual === "__sanitary__") return simple(<>
    <rect x="8" y="19" width="32" height="11" rx="5.5" fill="#f8f8fb" />
    <rect x="14" y="15" width="20" height="19" rx="9" fill="#e7edf6" />
    <rect x="18" y="18" width="12" height="13" rx="6" fill="#ffffff" />
  </>);
  if (visual === "__datefruit__") return simple(<>
    <ellipse cx="19" cy="27" rx="7" ry="12" transform="rotate(-18 19 27)" fill="#8a552e" />
    <ellipse cx="31" cy="24" rx="7" ry="12" transform="rotate(18 31 24)" fill="#9a6438" />
    <path d="M24 10c4-5 9-6 13-3-3 5-8 7-13 6Z" fill="#5f9f55" />
  </>);

  return visual ? <span className="text-3xl">{visual}</span> : <Tags className="h-7 w-7 text-primary/70" />;
}

function ProductThumb({
  name,
  category,
  imageUrl,
}: {
  name: string;
  category?: string | null;
  imageUrl?: string | null;
}) {
  const visual = productVisual(name, category);
  const useRuleIcon = forceProductVisual(name, category);
  const safeImageUrl = useRuleIcon ? null : imageUrl;

  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-muted/50">
      {safeImageUrl ? (
        <img
          src={safeImageUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-contain p-1"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            const fallback = event.currentTarget.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = "flex";
          }}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={`${safeImageUrl ? "hidden" : "flex"} h-full w-full items-center justify-center`}
      >
        <ProductVisualIcon visual={visual} />
      </span>
    </div>
  );
}

function VerdictBadge({ tone }: { tone: "good" | "ok" | "bad" | "unknown" }) {
  if (tone === "good") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-extrabold text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Vale a pena
      </span>
    );
  }
  if (tone === "bad") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-extrabold text-rose-400">
        <XCircle className="h-3.5 w-3.5" /> Não vale
      </span>
    );
  }
  if (tone === "ok") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-extrabold text-amber-400">
        <MinusCircle className="h-3.5 w-3.5" /> Preço ok
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted/60 px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" /> Sem histórico
    </span>
  );
}

function VerdictDelta({
  tone,
  deltaPct,
  reference,
}: {
  tone: "good" | "ok" | "bad" | "unknown";
  deltaPct: number | null;
  reference: string | null;
}) {
  if (deltaPct === null || tone === "unknown") {
    return (
      <div className="min-w-0 text-[11px] text-muted-foreground">
        <p>Sem referência histórica comparável</p>
      </div>
    );
  }

  const pct = Math.abs(deltaPct).toFixed(0);
  const content =
    tone === "good"
      ? { Icon: ArrowDown, cls: "text-emerald-400", text: `${pct}% mais barato` }
      : tone === "bad"
        ? { Icon: ArrowUp, cls: "text-rose-400", text: `${pct}% mais caro` }
        : { Icon: Minus, cls: "text-amber-400", text: `${pct}% na faixa` };
  const Icon = content.Icon;

  return (
    <div className="min-w-0">
      <p className={`flex items-center gap-1 text-sm font-extrabold ${content.cls}`}>
        <Icon className="h-4 w-4" />
        {content.text}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {reference ? `Referência: ${reference}` : "Referência histórica"}
      </p>
    </div>
  );
}

function Metric({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${className}`}>{value}</p>
    </div>
  );
}
