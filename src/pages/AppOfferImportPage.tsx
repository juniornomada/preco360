import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Save,
  Smartphone,
  Trash2,
} from "lucide-react";
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
const JOB_KEY = "preco360-active-app-offer-job";

type ExtractedAppOffer = {
  product_name: string;
  brand: string | null;
  package_quantity: number | null;
  package_unit: string | null;
  promotional_price: number;
  regular_price: number | null;
  valid_from: string | null;
  valid_to: string | null;
  app_activation_required: boolean;
  app_activated: boolean | null;
  notes: string[];
  confidence: number;
  source_index?: number;
  source_file_name?: string;
  source_image_path?: string;
  source_hash?: string | null;
};

type ReviewOffer = {
  localId: string;
  rawName: string;
  brand: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  price: number;
  regularPrice: number | null;
  validFrom: string;
  validTo: string;
  notes: string[];
  confidence: number;
  productId: string | null;
  matchConfidence: number;
  matchType: "exact" | "equivalent" | "suggested" | "manual" | "unmatched";
  sourceIndex: number;
  sourceFileName: string;
  sourceImagePath: string | null;
  sourceHash: string | null;
};

type AppOfferJob = {
  id: string;
  retailer: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress_current: number;
  progress_total: number;
  progress_label: string;
  source_files: any[];
  result: { offers?: ExtractedAppOffer[]; files?: any[] } | null;
  warning_message: string | null;
  error_message: string | null;
  saved_at: string | null;
  updated_at: string | null;
};

const todayLocal = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
    return `${file.name}-${file.size}-${file.lastModified}`;
  }
}

function numericInput(value: string) {
  const text = value.trim();
  if (!text) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayNumber(value: number | null) {
  return value == null || !Number.isFinite(value)
    ? ""
    : String(value).replace(".", ",");
}

function packageNameLabel(
  quantity: number | null | undefined,
  unit: string | null | undefined,
) {
  const value = Number(quantity);
  const rawUnit = String(unit ?? "").trim().toLowerCase();
  if (!Number.isFinite(value) || value <= 0 || !rawUnit) return "";

  const displayUnit =
    rawUnit === "l" || rawUnit === "lt" || rawUnit === "litro" || rawUnit === "litros"
      ? "L"
      : rawUnit === "kg" || rawUnit === "quilo" || rawUnit === "quilos"
        ? "kg"
        : rawUnit === "g" || rawUnit === "grama" || rawUnit === "gramas"
          ? "g"
          : rawUnit === "ml"
            ? "ml"
            : ["un", "und", "unid", "unidade", "unidades"].includes(rawUnit)
              ? "un"
              : String(unit).trim();

  const displayQuantity = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(value);

  return `${displayQuantity}${displayUnit}`;
}

function offerNameWithPackage(
  name: string,
  quantity: number | null | undefined,
  unit: string | null | undefined,
) {
  let cleanName = String(name ?? "").replace(/\s+/g, " ").trim();
  const label = packageNameLabel(quantity, unit);
  if (!cleanName || !label) return cleanName;

  const value = Number(quantity);
  const rawUnit = String(unit ?? "").trim().toLowerCase();
  const quantityPattern = String(value).replace(".", "[,.]");
  const unitPattern =
    rawUnit === "l" || rawUnit === "lt" || rawUnit === "litro" || rawUnit === "litros"
      ? "(?:l|lt|litro|litros)"
      : rawUnit === "kg" || rawUnit === "quilo" || rawUnit === "quilos"
        ? "(?:kg|quilo|quilos)"
        : rawUnit === "g" || rawUnit === "grama" || rawUnit === "gramas"
          ? "(?:g|grama|gramas)"
          : rawUnit === "ml"
            ? "ml"
            : ["un", "und", "unid", "unidade", "unidades"].includes(rawUnit)
              ? "(?:un|und|unid|unidade|unidades)"
              : rawUnit.replace(/[.*+?^$()|[\]\\]/g, "\\$&");

  // OCR from app cards sometimes leaves a packaging abbreviation plus a bare
  // quantity, and the UI used to append the parsed package again:
  // "FR 500 500ml" / "F 150 150ml". Collapse that to one clean size.
  const duplicatePackageSuffix = new RegExp(
    `\\s+(?:(?:f|fr|frasco|tp|pet|pct|pacote|cx|caixa)\\s+)?${quantityPattern}\\s+${quantityPattern}\\s*${unitPattern}\\s*$`,
    "i",
  );
  if (duplicatePackageSuffix.test(cleanName)) {
    cleanName = cleanName
      .replace(duplicatePackageSuffix, ` ${label}`)
      .replace(/\s+/g, " ")
      .trim();
  }

  const expected = inferPackage(label);
  const current = inferPackage(cleanName);

  if (
    expected &&
    current &&
    expected.baseUnit === current.baseUnit &&
    Math.abs(expected.baseQuantity - current.baseQuantity) < 0.0001
  ) {
    return cleanName;
  }

  // If the OCR kept only a trailing amount, optionally preceded by an
  // abbreviation such as F/FR/TP, replace that suffix with the complete size.
  // "Desodorante ... F 150" -> "Desodorante ... 150ml"
  // "Detergente ... FR 500" -> "Detergente ... 500ml"
  const barePackageSuffix = new RegExp(
    `\\s+(?:(?:f|fr|frasco|tp|pet|pct|pacote|cx|caixa)\\s+)?${quantityPattern}\\s*$`,
    "i",
  );
  if (barePackageSuffix.test(cleanName)) {
    return cleanName
      .replace(barePackageSuffix, ` ${label}`)
      .replace(/\s+/g, " ")
      .trim();
  }

  // If a previous package was present and the reviewer changes quantity/unit,
  // replace that package instead of accumulating two sizes in the name.
  if (current) {
    const packagePattern =
      /\b\d+(?:[.,]\d+)?\s*(?:kg|quilo|quilos|g|grama|gramas|ml|l|lt|litro|litros|un|und|unid|unidade|unidades)\b/i;
    if (packagePattern.test(cleanName)) {
      return cleanName.replace(packagePattern, label).replace(/\s+/g, " ").trim();
    }
  }

  return `${cleanName} ${label}`;
}

function offerNameWithBrandAndPackage(
  name: string,
  brand: string | null | undefined,
  quantity: number | null | undefined,
  unit: string | null | undefined,
) {
  const packaged = offerNameWithPackage(name, quantity, unit);
  const cleanBrand = String(brand ?? "").replace(/\s+/g, " ").trim();
  if (!packaged || !cleanBrand) return packaged;

  const normalizedName = normalizeSearchText(packaged);
  const normalizedBrand = normalizeSearchText(cleanBrand);
  if (!normalizedBrand || normalizedName.includes(normalizedBrand)) return packaged;

  const heads = [
    /^(doce\s+de\s+soro\s+de\s+leite)\b/i,
    /^(kit\s+shampoo\s+e\s+condicionador)\b/i,
    /^(lava\s+roupas\s+l[ií]quido)\b/i,
    /^(leite\s+condensado)\b/i,
    /^(extrato\s+de\s+tomate)\b/i,
    /^(fil[eé]\s+de\s+til[aá]pia)\b/i,
    /^(fermento\s+em\s+p[oó])\b/i,
    /^(iogurte\s+natural)\b/i,
    /^(mistura\s+para\s+bolo)\b/i,
    /^(milho\s+verde)\b/i,
    /^(lanche\s+hot\s+hit)\b/i,
    /^(bebida\s+l[aá]ctea)\b/i,
    /^(creme\s+de\s+leite)\b/i,
    /^(detergente\s+l[ií]quido)\b/i,
    /^(desodorante\s+aerossol)\b/i,
    /^(energ[eé]tico)\b/i,
    /^(hamb[uú]rguer)\b/i,
    /^(maionese)\b/i,
    /^(mostarda)\b/i,
    /^(gelatina)\b/i,
    /^(fralda)\b/i,
    /^(gin)\b/i,
    /^(caf[eé])\b/i,
    /^(chocolate)\b/i,
    /^(coquetel)\b/i,
  ];

  for (const head of heads) {
    const match = packaged.match(head);
    if (!match) continue;
    return packaged
      .replace(head, `${match[1]} ${cleanBrand}`)
      .replace(/\s+/g, " ")
      .trim();
  }

  // Safe fallback: keep the OCR wording and place the brand immediately
  // before the package size instead of omitting the brand.
  const label = packageNameLabel(quantity, unit);
  if (label && packaged.toLowerCase().endsWith(label.toLowerCase())) {
    return `${packaged.slice(0, -label.length).trim()} ${cleanBrand} ${label}`
      .replace(/\s+/g, " ")
      .trim();
  }

  return `${packaged} ${cleanBrand}`.replace(/\s+/g, " ").trim();
}

function candidateFromOffer(offer: ExtractedAppOffer): FlyerCandidate {
  const packageText =
    offer.package_quantity && offer.package_unit
      ? `${offer.package_quantity}${offer.package_unit}`
      : "";
  const packageInfo = inferPackage(
    `${offer.product_name} ${packageText}`.trim(),
  );
  const normalized = normalizedUnitPrice(offer.promotional_price, packageInfo);
  return {
    rawName: offerNameWithBrandAndPackage(
      offer.product_name,
      offer.brand,
      offer.package_quantity,
      offer.package_unit,
    ),
    brand: offer.brand,
    price: offer.promotional_price,
    packageInfo,
    normalizedPrice: normalized.normalizedPrice,
    baseUnit: normalized.baseUnit,
    clubPrice: false,
    sourcePage: offer.source_index ?? 1,
  };
}

async function invokeWorker(jobId: string) {
  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.functions.invoke("process-app-offer-job", {
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
  throw lastError ?? new Error("Não foi possível iniciar a análise.");
}

export default function AppOfferImportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [retailer, setRetailer] = useState("Max Atacadista");
  const [alreadyActivated, setAlreadyActivated] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ReviewOffer[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const appliedJobRef = useRef<string | null>(null);
  const queuedStartRef = useRef<string | null>(null);

  const { data: products = [] } = useQuery<ProductForMatch[]>({
    queryKey: ["app-offer-products", user?.id],
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
    queryKey: ["app-offer-aliases", user?.id],
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

  const { data: activeJob } = useQuery<AppOfferJob | null>({
    queryKey: ["app-offer-job", user?.id, activeJobId],
    enabled: !!user && !!activeJobId,
    refetchInterval: activeJobId ? 1500 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!activeJobId) return null;
      const { data, error } = await db
        .from("app_offer_import_jobs")
        .select(
          "id,retailer,status,progress_current,progress_total,progress_label,source_files,result,warning_message,error_message,saved_at,updated_at",
        )
        .eq("user_id", user!.id)
        .eq("id", activeJobId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void (async () => {
      const saved = localStorage.getItem(JOB_KEY);
      if (saved) {
        const { data } = await db
          .from("app_offer_import_jobs")
          .select("id,retailer,status,saved_at")
          .eq("user_id", user.id)
          .eq("id", saved)
          .maybeSingle();

        if (data && !data.saved_at && !cancelled) {
          setRetailer(data.retailer || "Max Atacadista");
          setActiveJobId(data.id);
          setAnalyzing(data.status === "queued" || data.status === "processing");
          return;
        }
        localStorage.removeItem(JOB_KEY);
      }

      const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: jobs } = await db
        .from("app_offer_import_jobs")
        .select("id,retailer,status,created_at")
        .eq("user_id", user.id)
        .in("status", ["queued", "processing"])
        .is("saved_at", null)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1);

      if (jobs?.[0] && !cancelled) {
        localStorage.setItem(JOB_KEY, jobs[0].id);
        setRetailer(jobs[0].retailer || "Max Atacadista");
        setActiveJobId(jobs[0].id);
        setAnalyzing(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!activeJob || !user) return;

    if (activeJob.status === "queued") {
      setAnalyzing(true);
      if (queuedStartRef.current !== activeJob.id) {
        queuedStartRef.current = activeJob.id;
        void invokeWorker(activeJob.id).catch(() => {
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

    const extracted = Array.isArray(activeJob.result?.offers)
      ? activeJob.result!.offers!
      : [];

    const seen = new Set<string>();
    const mapped: ReviewOffer[] = [];

    for (const offer of extracted) {
      const name = String(offer.product_name || "").trim();
      const displayName = offerNameWithBrandAndPackage(
        name,
        offer.brand,
        offer.package_quantity,
        offer.package_unit,
      );
      const price = Number(offer.promotional_price);
      if (!name || !Number.isFinite(price) || price <= 0) continue;

      const key = [
        normalizeSearchText(displayName),
        offer.package_quantity ?? "",
        normalizeSearchText(offer.package_unit ?? ""),
        price.toFixed(2),
        offer.valid_to ?? "",
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      const candidate = candidateFromOffer(offer);
      let match = {
        productId: null as string | null,
        confidence: 0,
        type: "unmatched" as ReviewOffer["matchType"],
      };

      try {
        const result = matchFlyerItem(
          candidate,
          products,
          aliases,
          canonicalRetailerName(activeJob.retailer),
        );
        match = {
          productId: result.productId,
          confidence: result.confidence,
          type: result.type,
        };
      } catch {
        // A leitura da oferta continua válida mesmo sem match automático.
      }

      mapped.push({
        localId: crypto.randomUUID(),
        rawName: displayName,
        brand: offer.brand ?? null,
        packageQuantity: offer.package_quantity ?? null,
        packageUnit: offer.package_unit ?? null,
        price,
        regularPrice:
          offer.regular_price == null ? null : Number(offer.regular_price),
        validFrom: offer.valid_from || todayLocal(),
        validTo: offer.valid_to || "",
        notes: Array.isArray(offer.notes) ? offer.notes : [],
        confidence: Number(offer.confidence) || 0,
        productId: match.productId,
        matchConfidence: match.confidence,
        matchType: match.productId ? match.type : "unmatched",
        sourceIndex: Number(offer.source_index) || 1,
        sourceFileName: offer.source_file_name || "app.jpg",
        sourceImagePath: offer.source_image_path || null,
        sourceHash: offer.source_hash || null,
      });
    }

    setRetailer(activeJob.retailer || retailer);
    setRows(mapped);

    toast({
      title: `${mapped.length} oferta(s) identificada(s)`,
      description:
        "Confira preço, embalagem e vigência. Depois salve para entrar em Ofertas e na Cesta.",
    });
  }, [activeJob, products, aliases, retailer, toast, user?.id]);

  const progressText = activeJob?.progress_label || (
    analyzing ? "Preparando análise no servidor…" : ""
  );

  const selectFiles = (selected: File[]) => {
    const images = selected.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    if (images.length > 30) {
      toast({
        title: "Selecione no máximo 30 prints",
        variant: "destructive",
      });
      return;
    }
    setFiles(images);
    setRows([]);
    setActiveJobId(null);
    appliedJobRef.current = null;
    queuedStartRef.current = null;
    localStorage.removeItem(JOB_KEY);
  };

  const analyze = async () => {
    if (!user || !retailer.trim() || !files.length) return;

    const jobId = crypto.randomUUID();
    const selected = [...files];
    setAnalyzing(true);
    setRows([]);

    try {
      const sourceFiles: any[] = [];

      for (let index = 0; index < selected.length; index += 2) {
        await Promise.all(
          selected.slice(index, index + 2).map(async (file, offset) => {
            const position = index + offset;
            const hash = await sha256(file);
            const storagePath =
              `${user.id}/app-offers/${jobId}/${String(position + 1).padStart(3, "0")}-${safeName(file.name || "app.jpg")}`;

            const { error } = await supabase.storage
              .from("flyers")
              .upload(storagePath, file, {
                contentType: file.type || "image/jpeg",
                upsert: false,
              });
            if (error) throw error;

            sourceFiles[position] = {
              index: position + 1,
              path: storagePath,
              name: file.name || `app-${position + 1}.jpg`,
              mime_type: file.type || null,
              size: file.size,
              hash,
            };
          }),
        );
      }

      const { error: jobError } = await db
        .from("app_offer_import_jobs")
        .insert({
          id: jobId,
          user_id: user.id,
          retailer: canonicalRetailerName(retailer),
          status: "queued",
          progress_current: 0,
          progress_total: selected.length,
          progress_label:
            "Prints recebidos. A análise continuará no servidor mesmo se você sair da tela.",
          source_files: sourceFiles,
          result: { files: [], offers: [] },
        });
      if (jobError) throw jobError;

      localStorage.setItem(JOB_KEY, jobId);
      setActiveJobId(jobId);

      try {
        await invokeWorker(jobId);
      } catch {
        toast({
          title: "Prints já estão salvos",
          description:
            "A primeira chamada não respondeu. Você pode sair da tela e voltar; o resultado foi preservado.",
        });
        return;
      }

      toast({
        title: "Análise iniciada",
        description:
          "O envio terminou. Agora você pode trocar de app; a leitura continua no servidor.",
      });
    } catch (error: any) {
      setAnalyzing(false);
      toast({
        title: "Não consegui enviar os prints",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const updateRow = (localId: string, patch: Partial<ReviewOffer>) => {
    setRows((current) =>
      current.map((row) => (row.localId === localId ? { ...row, ...patch } : row)),
    );
  };

  const save = async () => {
    if (!user || !rows.length || !retailer.trim()) return;

    const validRows = rows.filter(
      (row) =>
        row.rawName.trim() &&
        row.price > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.validFrom) &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.validTo),
    );

    if (!validRows.length) {
      toast({
        title: "Confira a vigência",
        description:
          "Cada oferta precisa ter nome, preço, data inicial e data final.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    try {
      const supermarket = canonicalRetailerName(retailer);
      const groups = new Map<string, ReviewOffer[]>();

      for (const row of validRows) {
        const key = `${row.validFrom}|${row.validTo}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }

      for (const [period, groupRows] of groups) {
        const [validFrom, validTo] = period.split("|");
        const sourceFiles = (activeJob?.source_files ?? []).filter((source: any) =>
          groupRows.some((row) => row.sourceIndex === Number(source.index)),
        );

        const { data: flyer, error: flyerError } = await db
          .from("flyers")
          .insert({
            user_id: user.id,
            retailer: supermarket,
            title: "Ofertas do app",
            valid_from: validFrom,
            valid_to: validTo,
            city: "Marília",
            source_type: "app",
            source_file_name: "Aplicativo " + supermarket,
            source_file_path: sourceFiles[0]?.path ?? null,
            source_files: sourceFiles,
            page_count: sourceFiles.length || null,
          })
          .select("id")
          .single();
        if (flyerError) throw flyerError;

        const itemRows = groupRows.map((row) => {
          const finalName = offerNameWithBrandAndPackage(
            row.rawName,
            row.brand,
            row.packageQuantity,
            row.packageUnit,
          );
          const packageInfo =
            row.packageQuantity && row.packageUnit
              ? inferPackage(`${row.packageQuantity}${row.packageUnit}`)
              : inferPackage(finalName);
          const normalized = normalizedUnitPrice(row.price, packageInfo);
          const notes = [
            ...row.notes,
            alreadyActivated
              ? "Oferta do app · ativada"
              : "Oferta do app · requer ativação",
          ];

          return {
            flyer_id: flyer.id,
            user_id: user.id,
            raw_name: finalName,
            normalized_name: normalizeSearchText(finalName),
            brand: row.brand,
            package_quantity: row.packageQuantity,
            package_unit: row.packageUnit,
            advertised_price: row.price,
            base_unit: normalized.baseUnit,
            normalized_price: normalized.normalizedPrice,
            club_price: false,
            club_advertised_price: null,
            product_id: row.productId,
            match_confidence: row.matchConfidence,
            match_type: row.productId ? row.matchType : "unmatched",
            source_page: row.sourceIndex,
            extraction_confidence: row.confidence,
            offer_notes: notes,
          };
        });

        const { error: itemsError } = await db.from("flyer_items").insert(itemRows);
        if (itemsError) throw itemsError;
      }

      if (activeJobId) {
        await db
          .from("app_offer_import_jobs")
          .update({ saved_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("id", activeJobId);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["live-market-flyers"] }),
        queryClient.invalidateQueries({ queryKey: ["live-market-offer-count"] }),
        queryClient.invalidateQueries({ queryKey: ["live-market-offer-search-v1"] }),
        queryClient.invalidateQueries({ queryKey: ["basket-active-data-v1"] }),
        queryClient.invalidateQueries({ queryKey: ["flyers"] }),
      ]);

      localStorage.removeItem(JOB_KEY);
      queuedStartRef.current = null;
      setFiles([]);
      setRows([]);
      setActiveJobId(null);
      appliedJobRef.current = null;

      toast({
        title: "Ofertas do app salvas",
        description:
          `${validRows.length} oferta(s) agora entram no Radar, nas buscas e na Cesta enquanto estiverem vigentes.`,
      });
      navigate("/offers");
    } catch (error: any) {
      toast({
        title: "Não consegui salvar as ofertas",
        description: error?.message || "Tente novamente.",
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
          Preço 360 · Ofertas do app
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          Importar prints do aplicativo
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          A IA lê produto, embalagem, preço promocional e vigência. Depois você
          revisa antes de salvar.
        </p>
      </header>

      <div className="space-y-4">
        <Card className="border-primary/20">
          <CardContent className="space-y-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                Supermercado
              </label>
              <Input
                value={retailer}
                onChange={(event) => setRetailer(event.target.value)}
                placeholder="Ex.: Max Atacadista"
              />
            </div>

            <label className="flex items-start gap-3 rounded-xl border bg-background/60 p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={alreadyActivated}
                onChange={(event) => setAlreadyActivated(event.target.checked)}
              />
              <span>
                <span className="block text-sm font-bold">
                  As ofertas já foram ativadas no aplicativo
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  Marcado por padrão para o seu fluxo atual do Max. O preço
                  importado será o preço efetivo considerado na compra.
                </span>
              </span>
            </label>

            <button
              type="button"
              disabled={analyzing || saving}
              className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-6 text-center disabled:opacity-60"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="h-7 w-7 text-primary" />
              <span className="mt-2 font-bold">
                {files.length
                  ? `${files.length} print(s) selecionado(s)`
                  : "Selecionar prints das ofertas"}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                Depois que o envio terminar, a análise continua no servidor.
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

            {files.length > 0 && !rows.length && !analyzing && (
              <Button
                className="h-11 w-full"
                onClick={() => void analyze()}
              >
                <Smartphone className="mr-2 h-4 w-4" />
                Analisar {files.length} print(s)
              </Button>
            )}

            {analyzing && (
              <div className="rounded-xl border bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {activeJob
                    ? `${activeJob.progress_current}/${activeJob.progress_total}`
                    : "Enviando"}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {progressText}
                </p>
              </div>
            )}

            {activeJob?.status === "failed" && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                {activeJob.error_message || "A análise ficou pausada."}
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-9 w-full"
                  onClick={() => activeJobId && void invokeWorker(activeJobId)}
                >
                  Retomar análise
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <>
            <Card className="border-primary/30">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/15 p-2 text-primary">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-bold">{rows.length} oferta(s) para revisar</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Corrija qualquer leitura antes de salvar. As datas podem ser
                      diferentes entre as ofertas.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {rows.map((row) => {
                const product = row.productId ? productMap.get(row.productId) : null;
                const normalized = normalizedUnitPrice(
                  row.price,
                  row.packageQuantity && row.packageUnit
                    ? inferPackage(`${row.packageQuantity}${row.packageUnit}`)
                    : inferPackage(row.rawName),
                );

                return (
                  <Card key={row.localId}>
                    <CardContent className="space-y-3 p-3">
                      <div className="flex gap-2">
                        <Input
                          value={row.rawName}
                          onChange={(event) =>
                            updateRow(row.localId, { rawName: event.target.value })
                          }
                          placeholder="Produto"
                        />
                        <button
                          type="button"
                          aria-label="Excluir oferta"
                          className="rounded-lg border px-2 text-muted-foreground"
                          onClick={() =>
                            setRows((current) =>
                              current.filter((item) => item.localId !== row.localId),
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">
                            Preço APP
                          </label>
                          <Input
                            inputMode="decimal"
                            value={displayNumber(row.price)}
                            onChange={(event) => {
                              const value = numericInput(event.target.value);
                              if (value !== null) updateRow(row.localId, { price: value });
                            }}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">
                            Conteúdo
                          </label>
                          <Input
                            inputMode="decimal"
                            value={displayNumber(row.packageQuantity)}
                            onChange={(event) =>
                              updateRow(row.localId, {
                                packageQuantity: numericInput(event.target.value),
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">
                            Unidade
                          </label>
                          <Input
                            value={row.packageUnit ?? ""}
                            onChange={(event) =>
                              updateRow(row.localId, {
                                packageUnit: event.target.value || null,
                              })
                            }
                            placeholder="g, kg, ml, L"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />
                            Início
                          </label>
                          <Input
                            type="date"
                            value={row.validFrom}
                            onChange={(event) =>
                              updateRow(row.localId, { validFrom: event.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />
                            Até
                          </label>
                          <Input
                            type="date"
                            value={row.validTo}
                            onChange={(event) =>
                              updateRow(row.localId, { validTo: event.target.value })
                            }
                          />
                        </div>
                      </div>

                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={row.productId ?? ""}
                        onChange={(event) => {
                          const productId = event.target.value || null;
                          updateRow(row.localId, {
                            productId,
                            matchType: productId ? "manual" : "unmatched",
                            matchConfidence: productId ? 1 : 0,
                          });
                        }}
                      >
                        <option value="">Sem vínculo com histórico</option>
                        {products.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          {normalized.baseUnit === "un"
                            ? brl(row.price)
                            : `${brl(normalized.normalizedPrice)}/${normalized.baseUnit === "l" ? "L" : normalized.baseUnit}`}
                        </span>
                        <span>
                          {product
                            ? `Vinculado: ${product.name}`
                            : `${Math.round(row.confidence * 100)}% confiança de leitura`}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Button
              className="h-12 w-full text-sm font-bold"
              disabled={saving || !rows.length}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {saving ? "Salvando…" : `Salvar ${rows.length} oferta(s) do app`}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
