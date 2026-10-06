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
import { DollarSign, Laptop, Loader2, LogOut, MapPin, Moon, Package, Plus, RefreshCw, Search, Store, Sun, Trash2, Upload } from "lucide-react";

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

      await queryClient.invalidateQueries({
        queryKey: ["profile-retailer-city-map-v1", selectedCityId],
      });

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
      const { data, error } = await supabase.functions.invoke("collect-marilia-flyers", {
        body: {
          manual: true,
          retailer: requestedRetailer || undefined,
          retailers: requestedRetailer || retailerCollectionList.length === 0
            ? undefined
            : retailerCollectionList,
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
                    const connected = retailerMap.some(
                      (item: any) =>
                        normalizeCitySearch(String(item.retailer)) ===
                          normalizeCitySearch(String(entry.retailer)) &&
                        item.status === "available",
                    );
                    return (
                      <div key={entry.retailer} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">{entry.retailer}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={connected ? "font-semibold text-emerald-600" : "text-muted-foreground"}>
                            {connected ? "fonte conectada" : "adicionada manualmente"}
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
        <div className="mb-3">
          <label htmlFor="retailer-to-collect" className="mb-1.5 block text-xs font-semibold">
            Qual supermercado deseja importar as ofertas?
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
            Digite uma rede específica. Se deixar vazio, o sistema tenta importar todas as redes encontradas ou adicionadas manualmente em {selectedCity?.name ?? "sua cidade"}.
          </p>
        </div>
        <Button type="button" className="w-full gap-2" onClick={runFlyerCollection} disabled={collecting}>
          {collecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {collecting ? "Executando coleta..." : retailerToCollect.trim() ? `Importar ofertas de ${retailerToCollect.trim()}` : retailerCollectionList.length ? `Importar ofertas de todos (${retailerCollectionList.length})` : `Coletar ofertas de ${selectedCity?.name ?? "minha cidade"}`}
        </Button>
        <Button type="button" variant="outline" className="mt-2 w-full gap-2" onClick={() => navigate("/radar?view=import")}><Upload className="h-4 w-4" />Importar ofertas, gôndola ou prints do app</Button>
        {collectionReport && <div className="mt-3 space-y-2">{collectionReport.map((row: any, i: number) => <div key={`${row.retailer}-${i}`} className="rounded-md border p-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium">{row.retailer}</span><span className="text-muted-foreground">{row.result}</span></div>{formatValidity(row.validity?.to) && <p className="mt-1 text-muted-foreground">Validade até {formatValidity(row.validity?.to)}</p>}{row.result === "resumo" && <p className="mt-1 text-muted-foreground">{row.found ?? 0} encontrado(s) · {row.imported ?? 0} novo(s) · {row.unchanged ?? 0} já conhecido(s) · {row.failed ?? 0} falha(s)</p>}{row.error && row.error !== "HTTP 200" && <p className="mt-1 text-destructive">{row.error}</p>}</div>)}</div>}
      </CardContent></Card>
      <Button variant="destructive" className="w-full" onClick={signOut}><LogOut className="h-4 w-4" />Sair da conta</Button>
    </div>
  );
}
