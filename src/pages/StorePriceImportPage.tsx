import { useMemo, useRef, useState } from "react";
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
  file: File;
  previewUrl: string;
  sourceHash: string;
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
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

  const { data: products = [] } = useQuery<ProductForMatch[]>({
    queryKey: ["store-price-products", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("products")
        .select("id,name,category,brand,package_size,unit")
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

  const clearAll = () => {
    rows.forEach((row) => URL.revokeObjectURL(row.previewUrl));
    setFiles([]);
    setRows([]);
    setProgress({ current: 0, total: 0 });
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
    file: File,
    sourceHash: string,
  ): ReviewObservation => {
    const candidate = observationCandidate({
      rawName: observation.product_name,
      brand: observation.brand,
      retailPrice: Number(observation.retail_price),
      packageQuantity: observation.package_quantity,
      packageUnit: observation.package_unit,
    });
    const match = matchFlyerItem(
      candidate,
      products,
      aliases,
      canonicalRetailerName(retailer),
    );
    return {
      localId: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      sourceHash,
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

  const analyzePhotos = async () => {
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

    setAnalyzing(true);
    setRows([]);
    setProgress({ current: 0, total: files.length });
    const parsedRows: ReviewObservation[] = [];
    const failures: string[] = [];

    try {
      for (let start = 0; start < files.length; start += 2) {
        const batch = files.slice(start, start + 2);
        const batchResults = await Promise.allSettled(
          batch.map(async (file) => {
            const sourceHash = await sha256(file);
            const body = new FormData();
            body.append("file", file, file.name || "preco-loja.jpg");
            const { data, error } = await supabase.functions.invoke(
              "analyze-store-price",
              { body },
            );
            if (error) throw error;
            if (!data?.observation) {
              throw new Error(
                `${file.name}: não consegui relacionar produto e preço nessa foto.`,
              );
            }
            return matchObservation(
              data.observation as ExtractedObservation,
              file,
              sourceHash,
            );
          }),
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            parsedRows.push(result.value);
          } else {
            failures.push(
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            );
          }
        }

        setProgress({
          current: Math.min(files.length, start + batch.length),
          total: files.length,
        });
      }

      setRows(parsedRows);
      if (!parsedRows.length) {
        toast({
          title: "Nenhum preço pôde ser lido",
          description:
            failures[0] ||
            "Tente fotos mais próximas da etiqueta e da embalagem correspondente.",
          variant: "destructive",
        });
      } else {
        toast({
          title: `${parsedRows.length} preço(s) identificado(s)`,
          description:
            failures.length > 0
              ? `${failures.length} foto(s) ficaram sem leitura e podem ser reenviadas.`
              : "Confira os nomes, valores e vínculos antes de salvar.",
        });
      }
    } finally {
      setAnalyzing(false);
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
        const sourcePath = `${user.id}/store-prices/${observedDate}/${row.sourceHash.slice(0, 20)}-${safeName(row.file.name || "preco.jpg")}`;
        const { error: uploadError } = await supabase.storage
          .from("flyers")
          .upload(sourcePath, row.file, {
            contentType: row.file.type || "image/jpeg",
            upsert: true,
          });
        if (uploadError) throw uploadError;

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
              source_file_name: row.file.name,
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
              className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-6 text-center"
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
                  Lendo fotos {progress.current}/{progress.total}
                </div>
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
              {analyzing ? "Analisando fotos…" : "Analisar preços"}
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
                              {row.file.name}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0"
                            onClick={() => {
                              URL.revokeObjectURL(row.previewUrl);
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
