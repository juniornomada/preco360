import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, CheckCircle2, Loader2, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  inferPackage,
  matchFlyerItem,
  normalizeSearchText,
  normalizedUnitPrice,
  type FlyerCandidate,
  type ProductForMatch,
} from "@/lib/flyerAnalysis";
import { canonicalRetailerName } from "@/lib/retailerNames";

const db = supabase as any;

type ExtractedObservation = {
  product_name: string;
  brand: string | null;
  barcode: string | null;
  package_quantity: number | null;
  package_unit: string | null;
  retail_price: number;
  wholesale_price: number | null;
  wholesale_min_quantity: number | null;
  price_basis_quantity: number | null;
  price_basis_unit: string | null;
  notes: string[];
  confidence: number;
};

type ReviewObservation = {
  localId: string;
  file: File | null;
  previewUrl: string;
  sourceHash: string;
  sourceImagePath: string | null;
  sourceFileName: string;
  rawName: string;
  brand: string | null;
  barcode: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  retailPrice: number;
  wholesalePrice: number | null;
  wholesaleMinQuantity: number | null;
  priceBasisQuantity: number | null;
  priceBasisUnit: string | null;
  notes: string[];
  confidence: number;
  productId: string | null;
  matchConfidence: number;
  matchType: "exact" | "equivalent" | "manual" | "unmatched";
};

type StorePriceAnalysisJob = {
  id: string;
  retailer: string;
  observed_date: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress_current: number;
  progress_total: number;
  progress_label: string;
  source_files: Array<{
    index: number;
    path: string;
    name: string;
    mime_type?: string | null;
    size?: number | null;
    hash?: string | null;
  }>;
  result: {
    observations?: Array<{
      index: number;
      source_file_name: string;
      source_image_path: string;
      source_hash: string | null;
      observation: ExtractedObservation;
      model?: string | null;
    }>;
    failures?: Array<{
      index: number;
      source_file_name: string;
      source_image_path: string;
      source_hash: string | null;
      reason: string;
    }>;
  } | null;
  warning_message: string | null;
  error_message: string | null;
  completed_at: string | null;
  saved_at: string | null;
  updated_at: string | null;
};

const STORE_PRICE_JOB_KEY = "preco360-active-store-price-analysis-job";

async function invokeStorePriceWorker(jobId: string) {
  let lastError: any = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.functions.invoke("process-store-price-job", {
      body: { job_id: jobId },
    });

    if (!error) return;

    lastError = error;
    if (attempt < 2) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, 900 * (attempt + 1)),
      );
    }
  }

  throw lastError ?? new Error("Não foi possível iniciar a análise no servidor.");
}

const todayLocal = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const safeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 90);

async function sha256(file: File) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Some Android gallery providers can lose direct blob access after selection.
    // Never discard an otherwise analyzable photo just because hashing failed.
    const fallback = new TextEncoder().encode(
      `${file.name}|${file.size}|${file.lastModified}|${file.type}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", fallback);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
}

function numberInput(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function displayNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  return String(value).replace(".", ",");
}

function observationCandidate(observation: {
  rawName: string;
  brand: string | null;
  retailPrice: number;
  packageQuantity: number | null;
  packageUnit: string | null;
}): FlyerCandidate {
  const packageText =
    observation.packageQuantity && observation.packageUnit
      ? `${observation.packageQuantity}${observation.packageUnit}`
      : "";
  const packageInfo = inferPackage(
    `${observation.rawName} ${packageText}`.trim(),
  );
  const normalized = normalizedUnitPrice(observation.retailPrice, packageInfo);
  return {
    rawName: observation.rawName,
    brand: observation.brand,
    price: observation.retailPrice,
    packageInfo,
    normalizedPrice: normalized.normalizedPrice,
    baseUnit: normalized.baseUnit,
    clubPrice: false,
    sourcePage: 1,
  };
}

export default function StorePriceImportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [retailer, setRetailer] = useState("");
  const [observedDate, setObservedDate] = useState(todayLocal());
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ReviewObservation[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [progressLabel, setProgressLabel] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const appliedJobRef = useRef<string | null>(null);
  const queuedStartRef = useRef<string | null>(null);
  const autoRetryJobRef = useRef<string | null>(null);

  const { data: products = [] } = useQuery<ProductForMatch[]>({
    queryKey: ["store-price-products", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("products")
        .select("id,name,category,brand,barcode,package_size,unit")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: aliases = [] } = useQuery<any[]>({
    queryKey: ["store-price-aliases", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("product_aliases")
        .select("product_id,normalized_alias,retailer")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const { data: activeJob } = useQuery<StorePriceAnalysisJob | null>({
    queryKey: ["store-price-analysis-job", user?.id, activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const { data, error } = await db
        .from("store_price_analysis_jobs")
        .select(
          "id,retailer,observed_date,status,progress_current,progress_total,progress_label,source_files,result,warning_message,error_message,completed_at,saved_at,updated_at",
        )
        .eq("user_id", user!.id)
        .eq("id", activeJobId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!user && !!activeJobId,
    refetchInterval: activeJobId ? 1500 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: 3,
  });

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const recover = async () => {
      const savedJobId = localStorage.getItem(STORE_PRICE_JOB_KEY);
      if (savedJobId) {
        const { data: savedJob } = await db
          .from("store_price_analysis_jobs")
          .select(
            "id,retailer,observed_date,status,progress_current,progress_total,progress_label,saved_at",
          )
          .eq("user_id", user.id)
          .eq("id", savedJobId)
          .maybeSingle();

        if (savedJob && !savedJob.saved_at && !cancelled) {
          setRetailer(savedJob.retailer || "");
          setObservedDate(savedJob.observed_date || todayLocal());
          setActiveJobId(savedJob.id);
          setAnalyzing(
            savedJob.status === "queued" || savedJob.status === "processing",
          );
          setProgress({
            current: Math.max(0, Number(savedJob.progress_current) || 0),
            total: Math.max(1, Number(savedJob.progress_total) || 1),
          });
          setProgressLabel(
            savedJob.progress_label || "Recuperando análise no servidor…",
          );
          return;
        }

        localStorage.removeItem(STORE_PRICE_JOB_KEY);
      }

      const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: activeJobs } = await db
        .from("store_price_analysis_jobs")
        .select(
          "id,retailer,observed_date,status,progress_current,progress_total,progress_label,created_at",
        )
        .eq("user_id", user.id)
        .in("status", ["queued", "processing"])
        .is("saved_at", null)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1);

      const serverJob = activeJobs?.[0];
      if (serverJob && !cancelled) {
        localStorage.setItem(STORE_PRICE_JOB_KEY, serverJob.id);
        setRetailer(serverJob.retailer || "");
        setObservedDate(serverJob.observed_date || todayLocal());
        setActiveJobId(serverJob.id);
        setAnalyzing(true);
        setProgress({
          current: Math.max(0, Number(serverJob.progress_current) || 0),
          total: Math.max(1, Number(serverJob.progress_total) || 1),
        });
        setProgressLabel(
          serverJob.progress_label || "Recuperando análise no servidor…",
        );
      }
    };

    void recover();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const clearAll = () => {
    rows.forEach((row) => {
      if (row.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(row.previewUrl);
      }
    });
    setFiles([]);
    setRows([]);
    setProgress({ current: 0, total: 0 });
    setProgressLabel("");
    setActiveJobId(null);
    appliedJobRef.current = null;
    queuedStartRef.current = null;
    autoRetryJobRef.current = null;
    localStorage.removeItem(STORE_PRICE_JOB_KEY);
    if (inputRef.current) inputRef.current.value = "";
  };

  const selectFiles = (selected: File[]) => {
    const images = selected.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    if (images.length > 30) {
      toast({
        title: "Muitas fotos de uma vez",
        description: "Selecione no máximo 30 imagens por pesquisa.",
        variant: "destructive",
      });
      return;
    }
    clearAll();
    setFiles(images);
  };

  const matchObservation = (
    observation: ExtractedObservation,
    file: File | null,
    sourceHash: string,
    sourceImagePath: string | null,
    sourceFileName: string,
    previewUrl: string,
    retailerOverride?: string,
  ): ReviewObservation => {
    let match: {
      productId: string | null;
      confidence: number;
      type: "exact" | "equivalent" | "manual" | "unmatched";
    } = {
      productId: null,
      confidence: 0,
      type: "unmatched",
    };

    try {
      const candidate = observationCandidate({
        rawName: observation.product_name,
        brand: observation.brand,
        retailPrice: Number(observation.retail_price),
        packageQuantity: observation.package_quantity,
        packageUnit: observation.package_unit,
      });
      const exactBarcodeProduct = observation.barcode
        ? products.find(
            (product) =>
              String(
                (product as ProductForMatch & { barcode?: string | null }).barcode ?? "",
              ).replace(/\D/g, "") ===
              String(observation.barcode).replace(/\D/g, ""),
          )
        : null;

      match = exactBarcodeProduct
        ? {
            productId: exactBarcodeProduct.id,
            confidence: 1,
            type: "exact" as const,
          }
        : matchFlyerItem(
            candidate,
            products,
            aliases,
            canonicalRetailerName(retailerOverride ?? retailer),
          );
    } catch (error) {
      // Product-history matching must never erase a successful visual read.
      console.warn("store-price product match failed", {
        file: sourceFileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      localId: crypto.randomUUID(),
      file,
      previewUrl,
      sourceHash,
      sourceImagePath,
      sourceFileName,
      rawName: observation.product_name.trim(),
      brand: observation.brand ?? null,
      barcode: observation.barcode ?? null,
      packageQuantity: observation.package_quantity ?? null,
      packageUnit: observation.package_unit ?? null,
      retailPrice: Number(observation.retail_price),
      wholesalePrice:
        observation.wholesale_price === null
          ? null
          : Number(observation.wholesale_price),
      wholesaleMinQuantity:
        observation.wholesale_min_quantity === null
          ? null
          : Number(observation.wholesale_min_quantity),
      priceBasisQuantity: observation.price_basis_quantity ?? null,
      priceBasisUnit: observation.price_basis_unit ?? null,
      notes: Array.isArray(observation.notes) ? observation.notes : [],
      confidence: Number(observation.confidence) || 0,
      productId: match.productId,
      matchConfidence: match.confidence,
      matchType: match.productId ? match.type : "unmatched",
    };
  };

  useEffect(() => {
    if (!activeJob || !user) return;

    setProgress({
      current: Math.max(0, Number(activeJob.progress_current) || 0),
      total: Math.max(1, Number(activeJob.progress_total) || 1),
    });
    setProgressLabel(
      activeJob.progress_label || "Processando fotos no servidor…",
    );

    if (activeJob.status === "queued") {
      setAnalyzing(true);

      if (queuedStartRef.current !== activeJob.id) {
        queuedStartRef.current = activeJob.id;
        void invokeStorePriceWorker(activeJob.id).catch((error) => {
          console.error("Automatic store-price job start failed", error);
          queuedStartRef.current = null;
        });
      }
      return;
    }

    if (activeJob.status === "processing") {
      setAnalyzing(true);
      return;
    }

    if (activeJob.status === "failed") {
      if (autoRetryJobRef.current !== activeJob.id) {
        autoRetryJobRef.current = activeJob.id;
        setAnalyzing(true);

        void (async () => {
          try {
            const { error: resetError } = await db
              .from("store_price_analysis_jobs")
              .update({
                status: "queued",
                error_message: null,
                completed_at: null,
                progress_label:
                  "Retomando automaticamente das fotos pendentes…",
              })
              .eq("user_id", user.id)
              .eq("id", activeJob.id);
            if (resetError) throw resetError;

            queuedStartRef.current = activeJob.id;
            await invokeStorePriceWorker(activeJob.id);
            await queryClient.invalidateQueries({
              queryKey: ["store-price-analysis-job", user.id, activeJob.id],
            });
          } catch (error: any) {
            setAnalyzing(false);
            toast({
              title: "A análise ficou pausada",
              description:
                error?.message ||
                activeJob.error_message ||
                "As fotos já enviadas foram preservadas e podem ser retomadas.",
              variant: "destructive",
            });
          }
        })();
        return;
      }

      setAnalyzing(false);
      return;
    }

    if (
      activeJob.status !== "completed" ||
      activeJob.saved_at ||
      appliedJobRef.current === activeJob.id
    ) {
      return;
    }

    appliedJobRef.current = activeJob.id;
    setAnalyzing(false);

    void (async () => {
      const observations = Array.isArray(activeJob.result?.observations)
        ? activeJob.result!.observations!
        : [];
      const failures = Array.isArray(activeJob.result?.failures)
        ? activeJob.result!.failures!
        : [];

      const mapped = await Promise.all(
        observations.map(async (entry) => {
          const localFile = files[entry.index - 1] ?? null;
          let previewUrl = localFile ? URL.createObjectURL(localFile) : "";

          if (!previewUrl && entry.source_image_path) {
            const { data } = await supabase.storage
              .from("flyers")
              .createSignedUrl(entry.source_image_path, 60 * 60);
            previewUrl = data?.signedUrl ?? "";
          }

          return matchObservation(
            entry.observation,
            localFile,
            entry.source_hash ||
              `${activeJob.id}-${String(entry.index).padStart(3, "0")}`,
            entry.source_image_path || null,
            entry.source_file_name || `foto-${entry.index}.jpg`,
            previewUrl,
            activeJob.retailer,
          );
        }),
      );

      setRetailer(activeJob.retailer || retailer);
      setObservedDate(activeJob.observed_date || observedDate);
      setRows(mapped);

      toast({
        title: `${mapped.length} preço(s) identificado(s)`,
        description: failures.length
          ? `${failures.length} foto(s) ficaram sem leitura confiável. As demais foram preservadas.`
          : "Todas as fotos foram analisadas no servidor. Confira antes de salvar.",
      });
    })();
  }, [
    activeJob,
    user?.id,
    files,
    products,
    aliases,
    retailer,
    observedDate,
    queryClient,
    toast,
  ]);

  const analyzePhotos = async () => {
    if (!user) return;

    if (!retailer.trim()) {
      toast({
        title: "Informe o mercado",
        description: "A pesquisa em loja precisa saber onde o preço foi observado.",
        variant: "destructive",
      });
      return;
    }
    if (!files.length) {
      toast({
        title: "Selecione as fotos",
        description: "Escolha uma ou mais fotos das etiquetas de preço.",
        variant: "destructive",
      });
      return;
    }

    const selected = [...files];
    const jobId = crypto.randomUUID();

    setAnalyzing(true);
    setRows([]);
    setProgress({ current: 0, total: selected.length });
    setProgressLabel(
      "Enviando fotos ao servidor. Mantenha esta tela aberta somente durante o envio…",
    );
    appliedJobRef.current = null;
    queuedStartRef.current = null;
    autoRetryJobRef.current = null;

    try {
      const sourceFiles: Array<{
        index: number;
        path: string;
        name: string;
        mime_type: string | null;
        size: number;
        hash: string;
      }> = [];

      let uploaded = 0;

      const uploadOne = async (file: File, index: number) => {
        const sourceHash = await sha256(file);
        const path =
          `${user.id}/store-prices/${observedDate}/${jobId}/${String(
            index + 1,
          ).padStart(3, "0")}-${safeName(file.name || "preco.jpg")}`;

        const { error } = await supabase.storage
          .from("flyers")
          .upload(path, file, {
            contentType: file.type || "image/jpeg",
            upsert: false,
          });
        if (error) throw error;

        sourceFiles[index] = {
          index: index + 1,
          path,
          name: file.name || `preco-${index + 1}.jpg`,
          mime_type: file.type || null,
          size: file.size,
          hash: sourceHash,
        };

        uploaded += 1;
        setProgress({ current: uploaded, total: selected.length });
        setProgressLabel(
          `Enviando fotos ${uploaded}/${selected.length}. Depois do envio você poderá trocar de app.`,
        );
      };

      for (let index = 0; index < selected.length; index += 2) {
        await Promise.all(
          selected
            .slice(index, index + 2)
            .map((file, offset) => uploadOne(file, index + offset)),
        );
      }

      const { error: jobError } = await db
        .from("store_price_analysis_jobs")
        .insert({
          id: jobId,
          user_id: user.id,
          retailer: canonicalRetailerName(retailer),
          observed_date: observedDate,
          status: "queued",
          progress_current: 0,
          progress_total: selected.length,
          progress_label:
            "Fotos recebidas. A análise continuará no servidor mesmo se você sair da tela.",
          source_files: sourceFiles,
          result: { observations: [], failures: [] },
        });
      if (jobError) throw jobError;

      localStorage.setItem(STORE_PRICE_JOB_KEY, jobId);
      setActiveJobId(jobId);
      setProgress({ current: 0, total: selected.length });
      setProgressLabel(
        "Fotos enviadas. A análise continua no servidor — você já pode trocar de app.",
      );

      queuedStartRef.current = jobId;
      try {
        await invokeStorePriceWorker(jobId);
      } catch (error) {
        queuedStartRef.current = null;
        await db
          .from("store_price_analysis_jobs")
          .update({
            status: "queued",
            progress_label:
              "Fotos salvas. Aguardando o servidor iniciar a análise…",
            warning_message:
              "A primeira chamada não respondeu; o app tentará retomar automaticamente.",
          })
          .eq("user_id", user.id)
          .eq("id", jobId);

        toast({
          title: "Fotos salvas no servidor",
          description:
            "Você não precisa reenviar. A análise será retomada automaticamente.",
        });
        return;
      }

      toast({
        title: "Análise iniciada no servidor",
        description:
          "As fotos já foram enviadas. Agora você pode trocar de app ou sair desta tela; o processamento continuará.",
      });
    } catch (error: any) {
      setAnalyzing(false);
      setProgress({ current: 0, total: 0 });
      setProgressLabel("");
      toast({
        title: "Não consegui enviar todas as fotos",
        description:
          error?.message ||
          "Mantenha esta tela aberta até o envio terminar e tente novamente.",
        variant: "destructive",
      });
    }
  };

  const updateRow = (localId: string, patch: Partial<ReviewObservation>) => {
    setRows((current) =>
      current.map((row) => (row.localId === localId ? { ...row, ...patch } : row)),
    );
  };

  const save = async () => {
    if (!user || !retailer.trim() || !observedDate || !rows.length) return;
    const supermarket = canonicalRetailerName(retailer);
    const validRows = rows.filter(
      (row) => row.rawName.trim() && row.retailPrice > 0,
    );
    if (!validRows.length) {
      toast({
        title: "Nenhum preço válido",
        description: "Confira os itens antes de salvar.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    let linked = 0;

    try {
      for (const row of validRows) {
        let sourcePath = row.sourceImagePath;

        if (!sourcePath) {
          if (!row.file) {
            throw new Error(
              `${row.sourceFileName}: a foto original não está mais disponível.`,
            );
          }

          sourcePath = `${user.id}/store-prices/${observedDate}/${row.sourceHash.slice(
            0,
            20,
          )}-${safeName(row.sourceFileName || row.file.name || "preco.jpg")}`;
          const { error: uploadError } = await supabase.storage
            .from("flyers")
            .upload(sourcePath, row.file, {
              contentType: row.file.type || "image/jpeg",
              upsert: true,
            });
          if (uploadError) throw uploadError;
        }

        const { data: observation, error: observationError } = await db
          .from("store_price_observations")
          .upsert(
            {
              user_id: user.id,
              product_id: row.productId,
              supermarket,
              observed_date: observedDate,
              raw_name: row.rawName.trim(),
              normalized_name: normalizeSearchText(row.rawName),
              brand: row.brand,
              barcode: row.barcode,
              package_quantity: row.packageQuantity,
              package_unit: row.packageUnit,
              retail_price: row.retailPrice,
              wholesale_price: row.wholesalePrice,
              wholesale_min_quantity: row.wholesaleMinQuantity,
              price_basis_quantity: row.priceBasisQuantity,
              price_basis_unit: row.priceBasisUnit,
              source_image_path: sourcePath,
              source_file_name:
                row.sourceFileName || row.file?.name || "preco-loja.jpg",
              source_hash: row.sourceHash,
              extraction_confidence: row.confidence,
              match_confidence: row.matchConfidence,
              match_type: row.matchType,
              notes: row.notes,
            },
            { onConflict: "user_id,source_hash" },
          )
          .select("id")
          .single();
        if (observationError) throw observationError;

        if (row.productId) {
          linked += 1;
          const { error: priceError } = await db.from("prices").upsert(
            {
              user_id: user.id,
              product_id: row.productId,
              supermarket,
              price: row.retailPrice,
              date: observedDate,
              source: "store_observation",
              receipt_text: row.rawName.trim(),
              store_observation_id: observation.id,
            },
            { onConflict: "store_observation_id" },
          );
          if (priceError) throw priceError;

          if (row.matchType === "manual" || row.matchConfidence >= 0.9) {
            const normalizedAlias = normalizeSearchText(row.rawName);
            const { data: existingAlias } = await db
              .from("product_aliases")
              .select("id")
              .eq("user_id", user.id)
              .eq("normalized_alias", normalizedAlias)
              .eq("retailer", supermarket)
              .maybeSingle();

            if (!existingAlias) {
              await db.from("product_aliases").insert({
                user_id: user.id,
                product_id: row.productId,
                alias: row.rawName.trim(),
                normalized_alias: normalizedAlias,
                retailer: supermarket,
              });
            }
          }
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["flyer-products"] }),
        queryClient.invalidateQueries({ queryKey: ["store-price-products"] }),
        queryClient.invalidateQueries({ queryKey: ["product-aliases"] }),
      ]);

      if (activeJobId) {
        await db
          .from("store_price_analysis_jobs")
          .update({ saved_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("id", activeJobId);
      }

      toast({
        title: "Pesquisa em loja salva",
        description:
          linked === validRows.length
            ? `${validRows.length} preço(s) entraram no histórico.`
            : `${validRows.length} observação(ões) salvas; ${linked} vinculada(s) ao histórico de produtos.`,
      });
      clearAll();
    } catch (error: any) {
      toast({
        title: "Não consegui salvar a pesquisa",
        description: error?.message ?? "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-background px-4 pb-28 pt-5 sm:px-6">
      <header className="mb-4">
        <Button
          type="button"
          variant="ghost"
          className="-ml-3 mb-2"
          onClick={() => navigate("/radar?view=import")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar ao Importar
        </Button>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
          Preço 360 · Pesquisa em loja
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          Fotografar preços de gôndola
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Envie fotos das etiquetas. A IA lê produto, embalagem e preço normal;
          preços de atacado ficam registrados separadamente.
        </p>
      </header>

      <div className="space-y-4">
        <Card className="border-primary/20">
          <CardContent className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Mercado
                </label>
                <Input
                  value={retailer}
                  onChange={(event) => setRetailer(event.target.value)}
                  placeholder="Ex.: Max Atacadista"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Data da pesquisa
                </label>
                <Input
                  type="date"
                  value={observedDate}
                  onChange={(event) => setObservedDate(event.target.value)}
                />
              </div>
            </div>

            <button
              type="button"
              disabled={analyzing || saving}
              className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-6 text-center disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => inputRef.current?.click()}
            >
              <Camera className="h-7 w-7 text-primary" />
              <span className="mt-2 font-bold">
                {files.length
                  ? `${files.length} foto(s) selecionada(s)`
                  : "Selecionar fotos dos preços"}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                Fotografe a etiqueta e a embalagem correspondente no mesmo enquadramento.
                Depois que o envio terminar, a análise continua no servidor mesmo em segundo plano.
              </span>
            </button>

            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) =>
                selectFiles(Array.from(event.target.files ?? []))
              }
            />

            {files.length > 0 && (
              <div className="rounded-xl border bg-background/60 p-2.5">
                <p className="text-xs font-bold">
                  {files.length} foto(s) pronta(s) para análise
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {files.map((file) => file.name).join(" · ")}
                </p>
              </div>
            )}

            {analyzing && (
              <div className="rounded-xl bg-muted p-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {progress.total > 0
                    ? `${progress.current}/${progress.total}`
                    : "Preparando análise"}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {progressLabel ||
                    "Processando fotos no servidor. Você pode trocar de app depois que o envio terminar."}
                </p>
              </div>
            )}

            <Button
              type="button"
              className="h-11 w-full font-bold"
              disabled={analyzing || saving || !files.length}
              onClick={() => void analyzePhotos()}
            >
              {analyzing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Camera className="mr-2 h-4 w-4" />
              )}
              {analyzing ? "Análise em andamento…" : "Analisar preços"}
            </Button>
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
                Conferir
              </p>
              <h2 className="text-lg font-extrabold">
                {rows.length} preço(s) identificado(s)
              </h2>
            </div>

            {rows.map((row) => {
              const linkedProduct = row.productId
                ? productMap.get(row.productId)
                : null;
              return (
                <Card key={row.localId}>
                  <CardContent className="p-3.5">
                    <div className="flex gap-3">
                      <img
                        src={row.previewUrl}
                        alt=""
                        className="h-20 w-20 shrink-0 rounded-xl border object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                              Leitura {Math.round(row.confidence * 100)}%
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {row.sourceFileName || row.file?.name || "Foto"}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0"
                            onClick={() => {
                              if (row.previewUrl.startsWith("blob:")) {
                                URL.revokeObjectURL(row.previewUrl);
                              }
                              setRows((current) =>
                                current.filter(
                                  (item) => item.localId !== row.localId,
                                ),
                              );
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2.5">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                          Produto lido
                        </label>
                        <Input
                          value={row.rawName}
                          onChange={(event) =>
                            updateRow(row.localId, {
                              rawName: event.target.value,
                            })
                          }
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                            Varejo
                          </label>
                          <Input
                            inputMode="decimal"
                            value={displayNumber(row.retailPrice)}
                            onChange={(event) =>
                              updateRow(row.localId, {
                                retailPrice:
                                  numberInput(event.target.value) ?? 0,
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                            Atacado
                          </label>
                          <Input
                            inputMode="decimal"
                            value={displayNumber(row.wholesalePrice)}
                            placeholder="—"
                            onChange={(event) =>
                              updateRow(row.localId, {
                                wholesalePrice: numberInput(event.target.value),
                              })
                            }
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                            Mínimo atacado
                          </label>
                          <Input
                            inputMode="numeric"
                            value={
                              row.wholesaleMinQuantity === null
                                ? ""
                                : String(row.wholesaleMinQuantity)
                            }
                            placeholder="—"
                            onChange={(event) =>
                              updateRow(row.localId, {
                                wholesaleMinQuantity:
                                  numberInput(event.target.value) === null
                                    ? null
                                    : Math.max(
                                        1,
                                        Math.trunc(
                                          numberInput(event.target.value)!,
                                        ),
                                      ),
                              })
                            }
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                          Vincular ao histórico
                        </label>
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={row.productId ?? ""}
                          onChange={(event) =>
                            updateRow(row.localId, {
                              productId: event.target.value || null,
                              matchType: event.target.value
                                ? "manual"
                                : "unmatched",
                              matchConfidence: event.target.value ? 1 : 0,
                            })
                          }
                        >
                          <option value="">Sem vínculo por enquanto</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {linkedProduct
                            ? `Vinculado a: ${linkedProduct.name}`
                            : "A observação será salva mesmo sem vínculo, mas só entra no histórico comparável quando ligada a um produto."}
                        </p>
                      </div>

                      {(row.barcode ||
                        row.packageQuantity ||
                        row.wholesalePrice !== null) && (
                        <div className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
                          {row.packageQuantity && row.packageUnit
                            ? `Embalagem: ${row.packageQuantity} ${row.packageUnit}`
                            : "Embalagem não confirmada"}
                          {row.barcode ? ` · EAN ${row.barcode}` : ""}
                          {row.wholesalePrice !== null &&
                          row.wholesaleMinQuantity
                            ? ` · atacado a partir de ${row.wholesaleMinQuantity} un.`
                            : ""}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
                  <div className="text-sm">
                    <p className="font-bold">
                      Preço de gôndola não vira oferta de tabloide
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      O varejo confirmado alimenta o histórico normal do produto.
                      Atacado, quantidade mínima e foto ficam preservados na pesquisa
                      em loja.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button
              type="button"
              className="h-12 w-full font-bold"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {saving ? "Salvando…" : `Salvar ${rows.length} preço(s)`}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
