import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const db = supabase as any;

function normalizeCitySearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronUp, DollarSign, Laptop, Loader2, LogOut, MapPin, Moon, Package, Plus, RefreshCw, Search, Store, Sun, Trash2, Upload } from "lucide-react";

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [collecting, setCollecting] = useState(false);
  const [collectionReport, setCollectionReport] = useState<any[] | null>(null);
  const [selectedCityId, setSelectedCityId] = useState("");
  const [selectedCity, setSelectedCity] = useState<any | null>(null);
  const [citySearch, setCitySearch] = useState("");
  const [debouncedCitySearch, setDebouncedCitySearch] = useState("");
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [savingCity, setSavingCity] = useState(false);
  const [searchingRetailers, setSearchingRetailers] = useState(false);
  const [retailerSearchDone, setRetailerSearchDone] = useState(false);
  const [retailerSearchMessage, setRetailerSearchMessage] = useState("");
  const [retailerToCollect, setRetailerToCollect] = useState("");
  const [manualRetailerName, setManualRetailerName] = useState("");
  const [savingManualRetailer, setSavingManualRetailer] = useState(false);
  const [syncingSources, setSyncingSources] = useState(false);
  const [expandedImportJobId, setExpandedImportJobId] = useState<string | null>(null);
  const [loadingImportJobId, setLoadingImportJobId] = useState<string | null>(null);
  const [importJobOffers, setImportJobOffers] = useState<Record<string, any[]>>({});

  const { data: cityPreference } = useQuery<any>({
    queryKey: ["profile-city-preference-v1", user?.id],
    queryFn: async () => {
      const { data, error } = await db.from("user_city_preferences").select("user_id,city_id,cities(id,name,state)").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  useEffect(() => {
    const preferredCity = cityPreference?.cities ?? null;
    if (!cityPreference?.city_id || !preferredCity) return;
    setSelectedCityId(cityPreference.city_id);
    setSelectedCity(preferredCity);
    setCitySearch(`${preferredCity.name} - ${preferredCity.state}`);
  }, [cityPreference?.city_id, cityPreference?.cities]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedCitySearch(citySearch);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [citySearch]);

  const normalizedCitySearch = normalizeCitySearch(debouncedCitySearch.replace(/\s*-\s*[A-Z]{2}$/i, ""));

  const { data: recentImportJobs = [] } = useQuery<any[]>({
    queryKey: ["profile-recent-flyer-import-jobs-v1", user?.id],
    queryFn: async () => {
      const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data, error } = await db
        .from("flyer_import_jobs")
        .select("id,retailer,source_file_name,status,progress_current,progress_total,progress_label,error_message,created_at,updated_at,completed_at")
        .eq("user_id", user!.id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  const activeImportJobs = recentImportJobs.filter((job: any) =>
    ["queued", "processing", "refining"].includes(String(job.status || "")),
  );
  const completedImportJobs = recentImportJobs.filter(
    (job: any) => String(job.status || "") === "completed",
  );

  const importJobOfferCount = (job: any) => {
    const match = String(job?.progress_label || "").match(/(\d+)\s+ofertas?\s+importadas?/i);
    return match ? Number(match[1]) : null;
  };

  const loadImportJobOffers = async (job: any) => {
    const jobId = String(job?.id || "");
    if (!jobId || !user) return;

    if (expandedImportJobId === jobId) {
      setExpandedImportJobId(null);
      return;
    }

    if (importJobOffers[jobId]) {
      setExpandedImportJobId(jobId);
      return;
    }

    setLoadingImportJobId(jobId);
    try {
      const { data, error } = await db
        .from("flyer_import_jobs")
        .select("result")
        .eq("id", jobId)
        .eq("user_id", user.id)
        .single();
      if (error) throw error;

      const offers = Array.isArray(data?.result?.offers) ? data.result.offers : [];
      setImportJobOffers((current) => ({ ...current, [jobId]: offers }));
      setExpandedImportJobId(jobId);
    } catch (err: any) {
      toast({
        title: "Não consegui abrir os produtos",
        description: err?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoadingImportJobId(null);
    }
  };


  const { data: cityResults = [], isFetching: searchingCities } = useQuery<any[]>({
    queryKey: ["profile-city-search-v2", normalizedCitySearch],
    queryFn: async () => {
      const { data, error } = await db
        .from("cities")
        .select("id,name,state")
        .eq("active", true)
        .ilike("search_name", `${normalizedCitySearch}%`)
        .order("name")
        .order("state")
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
    enabled: normalizedCitySearch.length >= 2,
  });

  const { data: retailerMap = [] } = useQuery<any[]>({
    queryKey: ["profile-retailer-city-map-v1", selectedCityId],
    queryFn: async () => {
      const { data, error } = await db.from("retailer_city_availability").select("retailer,status,source_count,notes,discovery_source").eq("city_id", selectedCityId).eq("discovery_source", "tiendeo").order("retailer");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedCityId,
  });

  const { data: manualRetailers = [] } = useQuery<any[]>({
    queryKey: ["profile-manual-retailers-v1", user?.id, selectedCityId],
    queryFn: async () => {
      const { data, error } = await db
        .from("user_city_retailers")
        .select("retailer,created_at")
        .eq("user_id", user!.id)
        .eq("city_id", selectedCityId)
        .order("retailer");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!selectedCityId,
  });

  const { data: sourceConnections = [] } = useQuery<any[]>({
    queryKey: ["profile-retailer-sources-v1", user?.id, selectedCityId],
    queryFn: async () => {
      const { data, error } = await db
        .from("user_city_retailer_sources")
        .select("retailer,official_site_url,offers_url,source_type,source_status,city_verified,capture_supported,collector_key,last_sync_at,last_offer_seen_at,last_error,metadata")
        .eq("user_id", user!.id)
        .eq("city_id", selectedCityId)
        .order("retailer");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!selectedCityId,
  });
  const retailerCollectionList = Array.from(
    new Map(
      [
        ...retailerMap.map((entry: any) => String(entry.retailer || "").trim()),
        ...manualRetailers.map((entry: any) => String(entry.retailer || "").trim()),
      ]
        .filter(Boolean)
        .map((retailer) => [normalizeCitySearch(retailer), retailer]),
    ).values(),
  ).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));

  const sourceConnectionMap = new Map(
    sourceConnections.map((source: any) => [
      normalizeCitySearch(String(source.retailer || "")),
      source,
    ]),
  );

  const sourceStatusLabel = (retailer: string) => {
    const key = normalizeCitySearch(retailer);
    const source = sourceConnectionMap.get(key) as any;
    const previouslyConnected = retailerMap.some(
      (entry: any) =>
        normalizeCitySearch(String(entry.retailer || "")) === key &&
        entry.status === "available",
    );

    if (!source) {
      return previouslyConnected
        ? { label: "fonte conectada", className: "font-semibold text-emerald-600" }
        : { label: "não verificada", className: "text-muted-foreground" };
    }

    if (source.source_status === "available" && source.capture_supported) {
      return { label: "fonte conectada", className: "font-semibold text-emerald-600" };
    }
    if (source.source_status === "available") {
      return { label: "oferta encontrada · captura pendente", className: "font-semibold text-amber-600" };
    }
    if (source.source_status === "no_offer") {
      return { label: "nenhuma oferta encontrada", className: "text-muted-foreground" };
    }
    if (source.source_status === "site_not_found") {
      return { label: "site não encontrado", className: "text-muted-foreground" };
    }
    if (source.source_status === "temporary_error") {
      return { label: "indisponível temporariamente", className: "font-semibold text-amber-600" };
    }
    if (source.source_status === "review") {
      return { label: "verificar", className: "font-semibold text-amber-600" };
    }
    return { label: "não verificada", className: "text-muted-foreground" };
  };

  const manualRetailerStatusLabel = (retailer: string) => {
    const key = normalizeCitySearch(retailer);
    const source = sourceConnectionMap.get(key) as any;
    const sourceStatus = sourceStatusLabel(retailer);

    if (
      source?.source_status === "available" ||
      retailerMap.some(
        (entry: any) =>
          normalizeCitySearch(String(entry.retailer || "")) === key &&
          entry.status === "available",
      )
    ) {
      return sourceStatus;
    }

    if (key === "max atacadista") {
      return {
        label: "importação manual disponível",
        className: "font-semibold text-sky-500",
      };
    }

    if (!source || source.source_status === "unverified") {
      return {
        label: "aguardando sincronização",
        className: "text-muted-foreground",
      };
    }

    return sourceStatus;
  };

  const capturableRetailers = retailerCollectionList.filter((retailer) => {
    const key = normalizeCitySearch(retailer);
    const source = sourceConnectionMap.get(key) as any;
    if (source?.source_status === "available" && source?.capture_supported) return true;
    return retailerMap.some(
      (entry: any) =>
        normalizeCitySearch(String(entry.retailer || "")) === key &&
        entry.status === "available",
    );
  });

  const dynamicCaptureSources = sourceConnections
    .filter(
      (source: any) =>
        source.source_status === "available" &&
        source.capture_supported &&
        source.offers_url,
    )
    .map((source: any) => ({
      retailer: source.retailer,
      offers_url: source.offers_url,
      asset_urls: Array.isArray(source.metadata?.assets)
        ? source.metadata.assets
            .map((asset: any) => String(asset?.url || "").trim())
            .filter(Boolean)
        : [],
    }));

  const syncSources = async (retailer?: string) => {
    if (!selectedCityId) return;
    setSyncingSources(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-retailer-sources", {
        body: {
          city_id: selectedCityId,
          retailer: retailer?.trim() || undefined,
        },
      });
      if (error) throw error;

      await queryClient.invalidateQueries({
        queryKey: ["profile-retailer-sources-v1", user?.id, selectedCityId],
      });

      const results = Array.isArray(data?.results) ? data.results : [];
      const available = results.filter((row: any) => row.source_status === "available").length;
      const connected = results.filter(
        (row: any) => row.source_status === "available" && row.capture_supported,
      ).length;
      const noOffer = results.filter((row: any) => row.source_status === "no_offer").length;
      const pending = results.length - available - noOffer;

      const parts = [
        String(results.length) + " rede(s) verificadas",
        String(available) + " com oferta/fonte disponível",
        String(connected) + " prontas para captura",
      ];
      if (noOffer) parts.push(String(noOffer) + " sem oferta encontrada");
      if (pending) parts.push(String(pending) + " para revisar");

      toast({
        title: "Sincronização concluída",
        description: parts.join(" · ") + ".",
      });
    } catch (err: any) {
      toast({
        title: "Erro ao sincronizar fontes",
        description: err?.message || "Não foi possível verificar as fontes agora.",
        variant: "destructive",
      });
    } finally {
      setSyncingSources(false);
    }
  };

  const addManualRetailer = async () => {
    const retailer = manualRetailerName.replace(/\s+/g, " ").trim();
    if (!user || !selectedCityId || !retailer) return;
    if (retailer.length < 2) {
      toast({ title: "Informe o supermercado", description: "Digite pelo menos 2 caracteres." });
      return;
    }

    setSavingManualRetailer(true);
    try {
      const { error } = await db.from("user_city_retailers").insert({
        user_id: user.id,
        city_id: selectedCityId,
        retailer,
      });
      if (error && error.code !== "23505") throw error;

      setManualRetailerName("");
      await queryClient.invalidateQueries({
        queryKey: ["profile-manual-retailers-v1", user.id, selectedCityId],
      });
      toast({
        title: error?.code === "23505" ? "Rede já cadastrada" : "Supermercado adicionado",
        description: error?.code === "23505"
          ? retailer + " já faz parte da lista desta cidade."
          : retailer + " foi adicionado à lista de " + (selectedCity?.name ?? "sua cidade") + ".",
      });
    } catch (err: any) {
      toast({
        title: "Não consegui adicionar a rede",
        description: err?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSavingManualRetailer(false);
    }
  };

  const removeManualRetailer = async (retailer: string) => {
    if (!user || !selectedCityId) return;
    try {
      const { error } = await db
        .from("user_city_retailers")
        .delete()
        .eq("user_id", user.id)
        .eq("city_id", selectedCityId)
        .eq("retailer", retailer);
      if (error) throw error;

      await queryClient.invalidateQueries({
        queryKey: ["profile-manual-retailers-v1", user.id, selectedCityId],
      });
      toast({ title: "Rede removida", description: retailer + " saiu da lista manual." });
    } catch (err: any) {
      toast({
        title: "Não consegui remover a rede",
        description: err?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!selectedCityId) return;
    let active = true;

    const refreshRetailers = async () => {
      setSearchingRetailers(true);
      setRetailerSearchDone(false);
      setRetailerSearchMessage("");

      const { data, error } = await supabase.functions.invoke("discover-city-retailers", {
        body: { city_id: selectedCityId },
      });

      if (!active) return;

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["profile-retailer-city-map-v1", selectedCityId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["profile-retailer-sources-v1", user?.id, selectedCityId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["profile-recent-flyer-import-jobs-v1", user?.id],
        }),
      ]);

      if (!active) return;

      const found = Array.isArray(data?.networks) ? data.networks.length : 0;

      if (error) {
        setRetailerSearchMessage("Não foi possível consultar as redes desta cidade agora. Tente novamente mais tarde.");
      } else if (found === 0) {
        setRetailerSearchMessage(
          data?.warning ||
            "Nenhuma rede principal de supermercado foi encontrada para esta cidade.",
        );
      } else {
        setRetailerSearchMessage("");
      }

      setSearchingRetailers(false);
      setRetailerSearchDone(true);
    };

    void refreshRetailers();
    return () => {
      active = false;
    };
  }, [selectedCityId, queryClient]);

  const saveCity = async (city: any) => {
    if (!user || !city?.id) return;
    setSavingCity(true);
    try {
      const { error } = await db
        .from("user_city_preferences")
        .upsert({ user_id: user.id, city_id: city.id }, { onConflict: "user_id" });
      if (error) throw error;

      setSelectedCityId(city.id);
      setSelectedCity(city);
      setSearchingRetailers(false);
      setRetailerSearchDone(false);
      setRetailerSearchMessage("");
      setCitySearch(`${city.name} - ${city.state}`);
      setCityPickerOpen(false);
      setRetailerToCollect("");
      setManualRetailerName("");
      toast({
        title: "Cidade atualizada",
        description: `${city.name} - ${city.state} agora é a referência do seu perfil.`,
      });
    } catch (err: any) {
      toast({ title: "Não consegui salvar a cidade", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSavingCity(false);
    }
  };

  const { data: stats } = useQuery({
    queryKey: ["profile-stats-v1", user?.id],
    queryFn: async () => {
      const { data, error } = await db.rpc("profile_stats_v1");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { products: Number(row?.product_count ?? 0), prices: Number(row?.price_count ?? 0), supermarkets: Number(row?.supermarket_count ?? 0) };
    },
    enabled: !!user,
  });

  const runFlyerCollection = async () => {
    setCollecting(true);
    setCollectionReport(null);
    try {
      if (!selectedCity || selectedCity.name !== "Marília" || selectedCity.state !== "SP") {
        toast({ title: "Coleta desta cidade ainda não está conectada", description: "A cidade foi cadastrada e o mapa de redes já está preparado. Agora precisamos validar as fontes oficiais dessa localidade." });
        return;
      }
      const requestedRetailer = retailerToCollect.trim();
      const availableRetailers = requestedRetailer
        ? [requestedRetailer]
        : capturableRetailers;
      const matchingSources = dynamicCaptureSources.filter((source: any) =>
        availableRetailers.some(
          (retailer) =>
            normalizeCitySearch(retailer) ===
            normalizeCitySearch(String(source.retailer || "")),
        ),
      );

      if (!requestedRetailer && availableRetailers.length === 0) {
        toast({
          title: "Nenhuma fonte pronta para importar",
          description: "Sincronize as fontes primeiro. O sistema importará apenas redes com fonte validada e captura disponível.",
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke("collect-marilia-flyers", {
        body: {
          manual: true,
          retailer: requestedRetailer || undefined,
          retailers: requestedRetailer ? undefined : availableRetailers,
          sources: matchingSources,
        },
      });
      if (error) throw error;
      const report = Array.isArray(data?.report) ? data.report : [];
      setCollectionReport(report);
      await queryClient.invalidateQueries({
        queryKey: ["profile-retailer-city-map-v1", selectedCityId],
      });
      const imported = report.filter((r: any) => r.result === "novo importado" || r.result === "novo enviado para processamento").length;
      const pendingCount = report.filter((r: any) => r.result === "fonte ainda não conectada").length;
      toast({
        title: pendingCount ? "Coleta concluída com pendências" : "Coleta concluída",
        description: pendingCount
          ? `${imported} nova(s) importação(ões) iniciada(s) e ${pendingCount} rede(s) ainda sem fonte automática.`
          : imported
            ? `${imported} nova(s) fonte(s)/oferta(s) enviada(s) para processamento.`
            : "Nenhuma oferta nova precisou ser importada.",
      });
    } catch (err: any) {
      toast({ title: "Erro na coleta", description: err?.message || "Não foi possível executar a coleta agora.", variant: "destructive" });
    } finally {
      setCollecting(false);
    }
  };

  const formatValidity = (value?: string | null) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(value + "T12:00:00");
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("pt-BR");
  };

  return (
    <div className="page-container">
      <h1 className="mb-6 text-xl font-bold">Perfil</h1>
      <Card className="mb-6"><CardContent className="p-4"><p className="font-medium">{user?.email}</p><p className="text-xs text-muted-foreground">Conta criada em {user?.created_at ? new Date(user.created_at).toLocaleDateString("pt-BR") : "-"}</p></CardContent></Card>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card><CardContent className="flex flex-col items-center p-4"><Package className="mb-1 h-5 w-5 text-primary" /><p className="text-2xl font-bold">{stats?.products ?? 0}</p><p className="text-xs text-muted-foreground">Produtos</p></CardContent></Card>
        <Card><CardContent className="flex flex-col items-center p-4"><DollarSign className="mb-1 h-5 w-5 text-primary" /><p className="text-2xl font-bold">{stats?.prices ?? 0}</p><p className="text-xs text-muted-foreground">Preços</p></CardContent></Card>
        <Card><CardContent className="flex flex-col items-center p-4"><Store className="mb-1 h-5 w-5 text-primary" /><p className="text-2xl font-bold">{stats?.supermarkets ?? 0}</p><p className="text-xs text-muted-foreground">Mercados</p></CardContent></Card>
      </div>
      <Card className="mb-6"><CardContent className="p-4"><div className="mb-3"><p className="font-medium">Aparência</p><p className="text-xs text-muted-foreground">Escolha como o Preço 360 deve aparecer.</p></div><div className="grid grid-cols-3 gap-2">
        <Button type="button" variant={theme === "light" ? "default" : "outline"} className="gap-2" onClick={() => setTheme("light")}><Sun className="h-4 w-4" />Claro</Button>
        <Button type="button" variant={theme === "dark" ? "default" : "outline"} className="gap-2" onClick={() => setTheme("dark")}><Moon className="h-4 w-4" />Escuro</Button>
        <Button type="button" variant={theme === "system" || !theme ? "default" : "outline"} className="gap-2" onClick={() => setTheme("system")}><Laptop className="h-4 w-4" />Sistema</Button>
      </div></CardContent></Card>
      <Card className="mb-6"><CardContent className="p-4">
        <div className="mb-3">
          <p className="font-medium">Ofertas e tabloides</p>
          <p className="text-xs text-muted-foreground">Digite sua cidade e selecione o município correto. As redes serão descobertas automaticamente pelo Tiendeo.</p>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={citySearch}
              onFocus={() => setCityPickerOpen(true)}
              onChange={(event) => {
                setCitySearch(event.target.value);
                setCityPickerOpen(true);
              }}
              placeholder="Ex.: Bauru"
              autoComplete="off"
              className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              disabled={savingCity}
            />

            {cityPickerOpen && normalizedCitySearch.length >= 2 && (
              <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
                {searchingCities && cityResults.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Buscando cidade...
                  </div>
                ) : cityResults.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">Nenhum município encontrado.</p>
                ) : (
                  cityResults.map((city: any) => (
                    <button
                      key={city.id}
                      type="button"
                      onClick={() => void saveCity(city)}
                      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <MapPin className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium">{city.name}</span>
                      <span className="text-muted-foreground">- {city.state}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {selectedCity && (
            <div className="mt-3 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold">Cidade selecionada: {selectedCity.name} - {selectedCity.state}</p>
              </div>

              <p className="mt-3 text-xs font-semibold">Redes encontradas no Tiendeo em {selectedCity.name} - {selectedCity.state}</p>
              <div className="mt-2 space-y-1">
                {retailerMap.length === 0 ? (
                  searchingRetailers ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Buscando supermercados desta cidade...
                    </div>
                  ) : retailerSearchDone ? (
                    <p className="text-xs text-muted-foreground">
                      {retailerSearchMessage || "Nenhuma rede principal de supermercado foi encontrada para esta cidade."}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Preparando busca de supermercados...</p>
                  )
                ) : retailerMap
                    .map((entry: any) => (
                      <div key={entry.retailer} className="flex items-center justify-between gap-2 text-xs">
                        <span>{entry.retailer}</span>
                        <span className={entry.status === "available" ? "font-semibold text-emerald-600" : entry.status === "discovered" ? "font-semibold text-primary" : "text-muted-foreground"}>
                          {entry.status === "available" ? "fonte conectada" : entry.status === "discovered" ? "encontrada" : "em validação"}
                        </span>
                      </div>
                    ))}
              </div>
            </div>
          )}

          {selectedCity && (
            <div className="mt-3 rounded-md border p-3">
              <p className="text-xs font-semibold">Adicionar supermercados manualmente</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                A lista fica salva para {selectedCity.name} - {selectedCity.state}. Redes sem integração continuam cadastradas até a fonte ser conectada.
              </p>

              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={manualRetailerName}
                  onChange={(event) => setManualRetailerName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addManualRetailer();
                    }
                  }}
                  placeholder="Ex.: Pão de Açúcar"
                  autoComplete="off"
                  className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={savingManualRetailer}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-1 px-3"
                  onClick={() => void addManualRetailer()}
                  disabled={savingManualRetailer || !manualRetailerName.trim()}
                >
                  {savingManualRetailer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Adicionar
                </Button>
              </div>

              {manualRetailers.length > 0 && (
                <div className="mt-3 space-y-1">
                  {manualRetailers.map((entry: any) => {
                    const status = manualRetailerStatusLabel(entry.retailer);
                    return (
                      <div key={entry.retailer} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">{entry.retailer}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={status.className}>
                            {status.label}
                          </span>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                            onClick={() => void removeManualRetailer(entry.retailer)}
                            aria-label={`Remover ${entry.retailer}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {selectedCity && retailerCollectionList.length > 0 && (
          <div className="mb-3 rounded-md border p-3">
            <p className="text-xs font-semibold">Fontes de ofertas</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              A sincronização pesquisa o site oficial, procura ofertas/encartes e confirma a cidade antes de liberar a captura.
            </p>

            <div className="mt-3 space-y-1.5">
              {retailerCollectionList.map((retailer) => {
                const status = sourceStatusLabel(retailer);
                const source = sourceConnectionMap.get(normalizeCitySearch(retailer)) as any;
                return (
                  <div key={retailer} className="rounded border px-2.5 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{retailer}</span>
                      <span className={status.className}>{status.label}</span>
                    </div>
                    {source?.source_type && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Fonte: {source.source_type === "api" ? "catálogo/API" : source.source_type === "web_catalog" ? "catálogo web" : String(source.source_type).toUpperCase()}
                        {source.city_verified ? " · cidade confirmada" : ""}
                      </p>
                    )}
                    {source?.last_error && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{source.last_error}</p>
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full gap-2"
              onClick={() => void syncSources()}
              disabled={syncingSources || collecting}
            >
              {syncingSources ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncingSources ? "Pesquisando sites e ofertas..." : "Sincronizar fontes de todos (" + retailerCollectionList.length + ")"}
            </Button>
          </div>
        )}

        <div className="mb-3">
          <label htmlFor="retailer-to-collect" className="mb-1.5 block text-xs font-semibold">
            Importar uma rede específica (opcional)
          </label>
          <input
            id="retailer-to-collect"
            type="text"
            value={retailerToCollect}
            onChange={(event) => setRetailerToCollect(event.target.value)}
            placeholder="Ex.: Swift, Tauste, Amigão... (vazio = todos)"
            list="retailer-suggestions"
            autoComplete="off"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            disabled={collecting || !selectedCity}
          />
          <datalist id="retailer-suggestions">
            {Array.from(new Set([
              ...retailerCollectionList,
              "Atacadão",
              "Max Atacadista",
              "Kawakami",
              "Confiança",
              "Tauste",
              "Swift",
              "Amigão",
            ])).map((retailer) => (
              <option key={retailer} value={retailer} />
            ))}
          </datalist>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Digite uma rede específica ou deixe vazio para importar apenas as fontes já validadas e capturáveis de {selectedCity?.name ?? "sua cidade"}.
          </p>
        </div>
        <Button type="button" className="w-full gap-2" onClick={runFlyerCollection} disabled={collecting}>
          {collecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {collecting ? "Executando coleta..." : retailerToCollect.trim() ? `Importar ofertas de ${retailerToCollect.trim()}` : `Importar ofertas disponíveis (${capturableRetailers.length})`}
        </Button>
        <Button type="button" variant="outline" className="mt-2 w-full gap-2" onClick={() => navigate("/radar?view=import")}><Upload className="h-4 w-4" />Importar ofertas, gôndola ou prints do app</Button>
        {collectionReport && <div className="mt-3 space-y-2">{collectionReport.map((row: any, i: number) => <div key={`${row.retailer}-${i}`} className="rounded-md border p-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium">{row.retailer}</span><span className="text-muted-foreground">{row.result}</span></div>{formatValidity(row.validity?.to) && <p className="mt-1 text-muted-foreground">Validade até {formatValidity(row.validity?.to)}</p>}{row.result === "resumo" && <p className="mt-1 text-muted-foreground">{row.found ?? 0} encontrado(s) · {row.imported ?? 0} novo(s) · {row.unchanged ?? 0} já conhecido(s) · {row.failed ?? 0} falha(s)</p>}{row.error && row.error !== "HTTP 200" && <p className="mt-1 text-destructive">{row.error}</p>}</div>)}</div>}
        {recentImportJobs.length > 0 && (
          <div className="mt-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Processamento das importações</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {activeImportJobs.length > 0
                    ? `${activeImportJobs.length} importação(ões) ainda em andamento. Esta área atualiza automaticamente.`
                    : "As importações recentes terminaram. Você já pode abrir a lista de produtos importados."}
                </p>
              </div>
              <span
                className={
                  activeImportJobs.length > 0
                    ? "shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-500"
                    : "shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-600"
                }
              >
                {activeImportJobs.length > 0 ? "PROCESSANDO" : "CONCLUÍDO"}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {recentImportJobs.map((job: any) => {
                const status = String(job.status || "");
                const isActive = ["queued", "processing", "refining"].includes(status);
                const isCompleted = status === "completed";
                const isFailed = status === "failed";
                const offerCount = importJobOfferCount(job);
                const expanded = expandedImportJobId === job.id;
                const offers = importJobOffers[job.id] ?? [];

                return (
                  <div key={job.id} className="rounded-md border p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">
                        {job.retailer || "Supermercado"}
                      </span>
                      <span
                        className={
                          isCompleted
                            ? "font-semibold text-emerald-600"
                            : isFailed
                              ? "font-semibold text-destructive"
                              : "font-semibold text-amber-500"
                        }
                      >
                        {isCompleted
                          ? "concluído"
                          : isFailed
                            ? "falhou"
                            : status === "queued"
                              ? "na fila"
                              : "processando"}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {job.source_file_name || "Importação automática"}
                    </p>

                    {isActive && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <span className="truncate">{job.progress_label || "Processando…"}</span>
                          {Number(job.progress_total) > 0 && (
                            <span className="shrink-0">
                              {Math.min(Number(job.progress_current) + 1, Number(job.progress_total))}/{Number(job.progress_total)}
                            </span>
                          )}
                        </div>
                        {Number(job.progress_total) > 0 && (
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(
                                    4,
                                    ((Number(job.progress_current) + 1) /
                                      Number(job.progress_total)) *
                                      100,
                                  ),
                                )}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {isCompleted && (
                      <div className="mt-2">
                        <p className="text-[11px] text-muted-foreground">
                          {offerCount != null
                            ? `${offerCount} produto(s) importado(s).`
                            : job.progress_label || "Importação concluída."}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={
                            expanded
                              ? "mt-2 h-8 w-full border-border bg-muted/35 text-xs text-foreground hover:bg-muted/60 active:bg-muted/60 focus-visible:ring-muted-foreground/30"
                              : "mt-2 h-8 w-full border-border bg-background text-xs text-foreground hover:bg-muted/50 active:bg-muted/50 focus-visible:ring-muted-foreground/30"
                          }
                          onClick={() => void loadImportJobOffers(job)}
                          disabled={loadingImportJobId === job.id}
                        >
                          {loadingImportJobId === job.id ? (
                            <>
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              Abrindo produtos…
                            </>
                          ) : expanded ? (
                            <>
                              <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
                              Ocultar produtos
                            </>
                          ) : (
                            <>
                              <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                              {`Ver produtos importados${offerCount != null ? ` (${offerCount})` : ""}`}
                            </>
                          )}
                        </Button>

                        {expanded && (
                          <div className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-2">
                            {offers.length > 0 && (
                              <p className="px-2 pb-1 text-[10px] text-muted-foreground">
                                Toque em um produto para abrir diretamente em Ofertas.
                              </p>
                            )}
                            {offers.length > 0 ? (
                              offers.map((offer: any, index: number) => {
                                const productName = String(
                                  offer?.product_name ||
                                    offer?.raw_name ||
                                    offer?.name ||
                                    "Produto",
                                ).trim();
                                const price = Number(
                                  offer?.promotional_price ??
                                    offer?.advertised_price ??
                                    offer?.price,
                                );
                                return (
                                  <button
                                    key={`${job.id}-${index}-${productName}`}
                                    type="button"
                                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                                    onClick={() =>
                                      navigate(
                                        `/offers?q=${encodeURIComponent(productName)}`,
                                      )
                                    }
                                  >
                                    <span className="min-w-0 truncate">{productName}</span>
                                    {Number.isFinite(price) && price > 0 && (
                                      <span className="shrink-0 font-semibold">
                                        {price.toLocaleString("pt-BR", {
                                          style: "currency",
                                          currency: "BRL",
                                        })}
                                      </span>
                                    )}
                                  </button>
                                );
                              })
                            ) : (
                              <p className="py-2 text-center text-[11px] text-muted-foreground">
                                O processamento terminou, mas não há uma lista detalhada de produtos neste job.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {isFailed && (
                      <p className="mt-2 text-[11px] text-destructive">
                        {job.error_message || "A importação falhou."}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {activeImportJobs.length === 0 && completedImportJobs.length > 0 && (
              <p className="mt-3 text-[11px] font-medium text-emerald-600">
                Tudo concluído. Toque em “Ver produtos importados” para saber exatamente o que entrou e abrir qualquer item em Ofertas.
              </p>
            )}
          </div>
        )}

      </CardContent></Card>
      <Button variant="destructive" className="w-full" onClick={signOut}><LogOut className="h-4 w-4" />Sair da conta</Button>
    </div>
  );
}
