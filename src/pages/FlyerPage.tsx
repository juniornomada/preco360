import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  BadgeCheck,
  CalendarDays,
  ChevronDown,
  FileImage,
  FileText,
  History,
  Loader2,
  Plus,
  Radar,
  Save,
  Sparkles,
  Store,
  Tags,
  Trash2,
  Upload,
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
import { readFlyerFileSmart } from "@/lib/flyerOcr";

const db = supabase as any;
type MatchType = "exact" | "equivalent" | "suggested" | "manual" | "unmatched";
type ReviewItem = FlyerCandidate & {
  localId: string;
  productId: string | null;
  matchConfidence: number;
  matchType: MatchType;
};
type View = "radar" | "import" | "history";

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

const dateBr = (value?: string | null) => {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

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

export default function FlyerPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View>("radar");
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [retailer, setRetailer] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });

  const { data: products = [] } = useQuery<ProductForMatch[]>({
    queryKey: ["flyer-products", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("products")
        .select("id,name,brand,package_size,unit,stockable,prices(price,date,supermarket)")
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
        .select("product_id,normalized_price,base_unit,advertised_price,created_at")
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
        .select("id,retailer,title,valid_from,valid_to,source_file_name,created_at,flyer_items(count)")
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
        .select("id,raw_name,advertised_price,normalized_price,base_unit,club_advertised_price,excluded_types,included_types,purchase_limit,store_restrictions,offer_notes,source_page")
        .eq("flyer_id", selectedHistoryId)
        .order("source_page", { ascending: true })
        .order("raw_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedHistoryId,
  });

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

  const matchOne = (candidate: FlyerCandidate): ReviewItem => {
    const match = matchFlyerItem(candidate, products, aliases, retailer);
    return {
      ...candidate,
      localId: crypto.randomUUID(),
      productId: match.productId,
      matchConfidence: match.confidence,
      matchType: match.type,
    };
  };

  const processFile = async () => {
    if (!file) return;
    setProcessing(true);
    setItems([]);

    try {
      const result = await readFlyerFileSmart(file, (current, total, label) =>
        setProgress({ current, total, label }),
      );

      const meta = extractFlyerMeta(result.metaText || result.textByPage.join("\n"));
      const direct = result as typeof result & {
        retailer?: string | null;
        validFrom?: string | null;
        validTo?: string | null;
      };
      const detectedRetailer = direct.retailer || meta.retailer;
      const detectedValidFrom = direct.validFrom || meta.validFrom;
      const detectedValidTo = direct.validTo || meta.validTo;

      if (detectedRetailer && !retailer) setRetailer(detectedRetailer);
      if (detectedValidFrom && !validFrom) setValidFrom(detectedValidFrom);
      if (detectedValidTo && !validTo) setValidTo(detectedValidTo);
      setPageCount(result.pageCount);

      // One unusual product must never discard the complete AI extraction.
      const matched = result.candidates.map((candidate) => {
        try {
          return matchOne(candidate);
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

      setItems(matched);
      setView("radar");

      const expectedMinimum = Math.max(4, result.pageCount * 5);
      const partial = result.candidates.length < expectedMinimum;
      toast({
        title: result.candidates.length
          ? `${result.candidates.length} ofertas encontradas`
          : "Leitura sem ofertas confiáveis",
        description: result.candidates.length
          ? `${matched.filter((item) => item.productId).length} relacionadas ao seu histórico.${partial ? " A leitura parece parcial; revise antes de salvar." : ""}`
          : "Tente novamente com o PDF original ou uma imagem mais nítida.",
        variant: result.candidates.length ? undefined : "destructive",
      });
    } catch (error: any) {
      toast({
        title: "Não consegui ler o tabloide",
        description: error?.message ?? "Tente outra imagem ou PDF.",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
      setProgress({ current: 0, total: 0, label: "" });
    }
  };

  const recalc = (item: ReviewItem, rawName: string, price: number) => {
    const packageInfo = inferPackage(rawName);
    const normalized = normalizedUnitPrice(price, packageInfo);
    const candidate: FlyerCandidate = {
      rawName,
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
    if (!user || !file || !retailer.trim()) {
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
      const fileHash = await sha256(file);
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
            source_type: file.type === "application/pdf" ? "pdf" : "image",
            source_file_name: file.name,
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
        const path = `${user.id}/${Date.now()}-${safeName(file.name || "tabloide")}`;
        const { error: uploadError } = await supabase.storage
          .from("flyers")
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (uploadError) throw uploadError;

        const { data: insertedFlyer, error: flyerError } = await db
          .from("flyers")
          .insert({
            user_id: user.id,
            retailer: retailer.trim(),
            title: `${retailer.trim()} · ${validFrom ? dateBr(validFrom) : "Ofertas"}`,
            valid_from: validFrom || null,
            valid_to: validTo || null,
            source_type: file.type === "application/pdf" ? "pdf" : "image",
            source_file_name: file.name,
            source_file_path: path,
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
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Radar 360</p>
          <h1 className="mt-1 text-[clamp(1.65rem,7vw,2rem)] font-extrabold tracking-tight">
            Ofertas que realmente valem
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Compare preço ofertado com preço pago, normalizando kg, litro e embalagem.
          </p>
        </div>
        <div className="rounded-2xl bg-primary/10 p-3 text-primary">
          <Radar className="h-6 w-6" />
        </div>
      </header>

      <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-muted p-1">
        {([
          ["radar", "Radar", Sparkles],
          ["import", "Importar", Upload],
          ["history", "Histórico", History],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${
              view === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {view === "import" && (
        <div className="space-y-3">
          <Card className="border-primary/20">
            <CardContent className="p-5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 px-5 py-8 text-center"
              >
                <div className="mb-3 rounded-2xl bg-primary/15 p-3 text-primary">
                  {file?.type === "application/pdf" ? (
                    <FileText className="h-7 w-7" />
                  ) : (
                    <FileImage className="h-7 w-7" />
                  )}
                </div>
                <p className="font-bold">{file ? file.name : "Escolher PDF ou foto do tabloide"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  O arquivo original fica guardado como evidência do preço ofertado.
                </p>
              </button>

              <input
                ref={fileRef}
                className="hidden"
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">Mercado</label>
                  <Input value={retailer} onChange={(event) => setRetailer(event.target.value)} placeholder="Ex.: Confiança" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">Válido de</label>
                  <Input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">Até</label>
                  <Input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} />
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
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${progress.total ? Math.max(8, (progress.current / progress.total) * 100) : 15}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <Button className="mt-4 h-11 w-full" disabled={!file || processing} onClick={() => void processFile()}>
                {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {processing ? "Lendo ofertas…" : "Analisar tabloide"}
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
                                <p className="font-extrabold">{brl(item.price)}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {formatNormalizedPrice(item.normalizedPrice, item.baseUnit)}
                                </p>
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
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatNormalizedPrice(item.normalizedPrice || item.price, item.baseUnit)}</span>
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
                <Button className="mt-3 h-11 w-full" disabled={saving || !file} onClick={() => void saveFlyer()}>
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
                          {selectedHistoryItems.map((item) => (
                            <div key={item.id} className="rounded-lg border bg-background p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-semibold">{item.raw_name}</p>
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    Página {item.source_page ?? "—"}
                                    {item.normalized_price
                                      ? ` · ${formatNormalizedPrice(Number(item.normalized_price), item.base_unit || "un")}`
                                      : ""}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="font-extrabold">{brl(Number(item.advertised_price))}</p>
                                  {item.club_advertised_price ? (
                                    <p className="text-[11px] font-semibold text-primary">
                                      Clube {brl(Number(item.club_advertised_price))}
                                    </p>
                                  ) : null}
                                </div>
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
                                <p className="mt-1 text-xs text-muted-foreground">Limite: {item.purchase_limit}</p>
                              ) : null}
                              {Array.isArray(item.store_restrictions) && item.store_restrictions.length > 0 ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Lojas: {item.store_restrictions.join(", ")}
                                </p>
                              ) : null}
                            </div>
                          ))}
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

function Metric({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${className}`}>{value}</p>
    </div>
  );
}
