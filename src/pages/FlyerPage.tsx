import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ProductVisual from "@/components/ProductVisual";
import AdaptiveProductName from "@/components/AdaptiveProductName";
import { ensureClubActivationNote } from "@/lib/clubOfferRules";
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
  visionResponseToFlyerResult,
  type VisionResponse,
} from "@/lib/flyerOcr";

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

const isTransientImportError = (message?: string | null) =>
  /timed out|timeout|429|resource exhausted|overloaded|temporar|502|503|504/i.test(
    message ?? "",
  );

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

async function pdfToUploadPages(
  file: File,
  onProgress: (page: number, total: number) => void,
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: File[] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    onProgress(pageNo, pdf.numPages);
    const page = await pdf.getPage(pageNo);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = Math.min(
      2600,
      Math.max(2200, baseViewport.width * 3.7),
    );
    const viewport = page.getViewport({
      scale: targetWidth / baseViewport.width,
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error(`Não foi possível preparar a página ${pageNo} do PDF.`);
    }

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport } as any).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    canvas.width = 1;
    canvas.height = 1;

    if (!blob) {
      throw new Error(`Não foi possível compactar a página ${pageNo} do PDF.`);
    }

    const baseName = file.name.replace(/\.pdf$/i, "") || "tabloide";
    pages.push(
      new File(
        [blob],
        `${baseName}-pagina-${String(pageNo).padStart(3, "0")}.jpg`,
        { type: "image/jpeg" },
      ),
    );
  }

  return pages;
}

export default function FlyerPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View>(() => {
    const requested = searchParams.get("view");
    return requested === "import" || requested === "history" ? requested : "radar";
  });
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
  const autoRetryJobRef = useRef<string | null>(null);

  const resetImportForm = () => {
    setFile(null);
    setFiles([]);
    setItems([]);
    setRetailer("");
    setValidFrom("");
    setValidTo("");
    setPageCount(null);
    setProcessedSource(null);
    setActiveJobId(null);
    setProcessing(false);
    setProgress({ current: 0, total: 0, label: "" });
    appliedJobRef.current = null;
    autoRetryJobRef.current = null;
    localStorage.removeItem(IMPORT_JOB_KEY);
    if (fileRef.current) fileRef.current.value = "";
  };

  const changeView = (next: View) => {
    // A completed/saved import must never leak into a new import form.
    // The stale state from older builds is recognizable by files[] still being
    // populated while the primary file/job/review have already been cleared.
    if (
      next === "import" &&
      !file &&
      files.length > 0 &&
      !activeJobId &&
      !processing &&
      !processedSource &&
      items.length === 0
    ) {
      resetImportForm();
    }
    setView(next);
  };

  const { data: products = [] } = useQuery<ProductForMatch[]>({
    queryKey: ["flyer-products", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("products")
        .select("id,name,category,brand,package_size,unit,stockable,image_url,image_source,prices(price,date,supermarket)")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && (view === "import" || !!selectedHistoryId || items.length > 0),
  });

  const { data: aliases = [] } = useQuery<any[]>({
    queryKey: ["product-aliases", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("product_aliases")
        .select("product_id,normalized_alias,retailer")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && view === "import",
  });

  const { data: previousOffers = [] } = useQuery<any[]>({
    queryKey: ["flyer-item-history", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyer_items")
        .select("flyer_id,product_id,normalized_price,base_unit,advertised_price,created_at")
        .eq("user_id", user!.id)
        .not("product_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1500);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && (items.length > 0 || !!selectedHistoryId),
  });

  const { data: flyerHistory = [] } = useQuery<any[]>({
    queryKey: ["flyers", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyers")
        .select("id,retailer,title,valid_from,valid_to,source_file_name,source_file_path,created_at,flyer_items(count)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && view === "history",
  });

  const { data: selectedHistoryItems = [], isLoading: historyItemsLoading } = useQuery<any[]>({
    queryKey: ["flyer-history-items", selectedHistoryId],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyer_items")
        .select("id,product_id,raw_name,brand,package_quantity,package_unit,advertised_price,normalized_price,base_unit,club_advertised_price,excluded_types,included_types,purchase_limit,store_restrictions,offer_notes,source_page,image_url,image_source,image_confidence,image_match_status")
        .eq("user_id", user!.id)
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
    if (!user || view !== "import") return;

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

      // Recover a recent timeout job first. Older builds removed the local
      // job id when a timeout marked the job as failed, even though completed
      // pages and uploaded source files were still intact.
      const failedCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: failedJobs } = await db
        .from("flyer_import_jobs")
        .select("id,error_message,created_at")
        .eq("status", "failed")
        .gte("created_at", failedCutoff)
        .order("created_at", { ascending: false })
        .limit(5);

      const recoverableFailure = (failedJobs ?? []).find((job: any) =>
        isTransientImportError(job.error_message),
      );

      if (recoverableFailure && !cancelled) {
        localStorage.setItem(IMPORT_JOB_KEY, recoverableFailure.id);
        setActiveJobId(recoverableFailure.id);
        setProgress({
          current: 1,
          total: 1,
          label: "Recuperando importação interrompida…",
        });
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
  }, [user?.id, view]);

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
      const transient = isTransientImportError(activeJob.error_message);

      if (transient && autoRetryJobRef.current !== activeJob.id) {
        autoRetryJobRef.current = activeJob.id;
        setProcessing(true);
        localStorage.setItem(IMPORT_JOB_KEY, activeJob.id);

        void (async () => {
          try {
            const { error: resetError } = await db
              .from("flyer_import_jobs")
              .update({
                status: "queued",
                error_message: null,
                warning_message:
                  "Retomada automática após uma resposta lenta da IA.",
                completed_at: null,
                progress_label:
                  "Retomando automaticamente da primeira página pendente…",
              })
              .eq("id", activeJob.id);
            if (resetError) throw resetError;

            const { error: invokeError } = await supabase.functions.invoke(
              "process-flyer-job",
              { body: { job_id: activeJob.id, mode: "resume" } },
            );
            if (invokeError) throw invokeError;

            await queryClient.invalidateQueries({
              queryKey: ["flyer-import-job", user?.id, activeJob.id],
            });

            toast({
              title: "Importação retomada automaticamente",
              description:
                "As páginas já concluídas foram preservadas. O Radar continuará da página pendente.",
            });
          } catch (error: any) {
            setProcessing(false);
            localStorage.removeItem(IMPORT_JOB_KEY);
            toast({
              title: "A retomada automática não concluiu",
              description: error?.message ?? "O processamento continua disponível para nova tentativa.",
              variant: "destructive",
            });
          }
        })();

        return;
      }

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
    const isPdf =
      selected.length === 1 &&
      (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

    setProcessing(true);
    setItems([]);
    setProcessedSource(null);
    appliedJobRef.current = null;

    try {
      setProgress({ current: 1, total: 3, label: "Preparando arquivo…" });

      const fileHashPromise = sha256Files(selected);
      let uploadPages: File[] = selected;

      if (isPdf) {
        uploadPages = await pdfToUploadPages(file, (pageNo, total) => {
          setProgress({
            current: pageNo,
            total,
            label: `Preparando página ${pageNo}/${total} do PDF…`,
          });
        });
      }

      const fileHash = await fileHashPromise;
      const detectedPages = isPdf
        ? uploadPages.length
        : selected.length > 1
          ? selected.length
          : 1;
      setPageCount(detectedPages);

      const jobId = crypto.randomUUID();
      const sourceFiles: SourceFileEntry[] = [];
      let originalSourcePath: string | null = null;

      setProgress({
        current: 2,
        total: 3,
        label: isPdf
          ? `Enviando PDF e ${detectedPages} página(s) otimizadas…`
          : selected.length > 1
            ? `Enviando ${selected.length} páginas para o servidor…`
            : "Enviando o tabloide para o servidor…",
      });

      if (isPdf) {
        originalSourcePath =
          `${user.id}/imports/${jobId}/source-${safeName(file.name || "tabloide.pdf")}`;
        const { error: originalUploadError } = await supabase.storage
          .from("flyers")
          .upload(originalSourcePath, file, {
            contentType: file.type || "application/pdf",
            upsert: false,
          });
        if (originalUploadError) throw originalUploadError;
      }

      const uploadOne = async (source: File, index: number) => {
        const pagePrefix =
          uploadPages.length > 1
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

        sourceFiles[index] = {
          path,
          name: source.name || `pagina-${index + 1}`,
          mime_type: source.type || null,
          size: source.size,
        };
      };

      // Keep upload concurrency modest for mobile connections while still
      // avoiding one-request-at-a-time latency.
      for (let index = 0; index < uploadPages.length; index += 2) {
        await Promise.all(
          uploadPages
            .slice(index, index + 2)
            .map((source, offset) => uploadOne(source, index + offset)),
        );
      }

      const primarySource = sourceFiles[0];
      const sourceFileName =
        isPdf
          ? file.name || "tabloide.pdf"
          : selected.length > 1
            ? `Tabloide · ${selected.length} imagens`
            : file.name || "tabloide";

      const { error: jobError } = await db.from("flyer_import_jobs").insert({
        id: jobId,
        user_id: user.id,
        source_file_path: originalSourcePath || primarySource.path,
        source_file_name: sourceFileName,
        mime_type: isPdf
          ? file.type || "application/pdf"
          : selected.length > 1
            ? "image/multi"
            : file.type || null,
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
        label:
          detectedPages > 1
            ? `${detectedPages} páginas preparadas. A IA processa até 2 em paralelo.`
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
            offer_notes: ensureClubActivationNote(
              retailer.trim(),
              rich.clubAdvertisedPrice,
              rich.offerNotes,
            ),
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
          : `${validItems.length} ofertas agora fazem parte do histórico do Radar.`,
      });
      resetImportForm();
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
    <div className="page-container !pb-40 mx-auto w-full max-w-3xl">
      <header className="mb-3 flex items-start justify-between gap-3 sm:mb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary sm:text-xs">Radar</p>
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
            onClick={() => changeView(key)}
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
            <span className="block text-sm font-bold">Cesta · Comparar supermercados</span>
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
                <Button className="mt-4" onClick={() => changeView("import")}>
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
                                <AdaptiveProductName text={item.rawName} className="font-bold" />
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
                                  <ProductVisual
                                    name={displayProductName(item.raw_name)}
                                    category={item.product?.category}
                                    imageUrl={item.image_url || item.product?.image_url}
                                  />

                                  <div className="min-w-0 flex-1">
                                    <AdaptiveProductName
                                      text={displayProductName(item.raw_name)}
                                      className="font-bold"
                                    />
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
