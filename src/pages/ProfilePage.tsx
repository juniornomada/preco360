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
import { DollarSign, Laptop, Loader2, LogOut, MapPin, Moon, Package, RefreshCw, Search, Store, Sun, Upload } from "lucide-react";

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
  const [syncingCities, setSyncingCities] = useState(false);

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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const ensureBrazilCities = async () => {
      const { count, error } = await db
        .from("cities")
        .select("id", { count: "exact", head: true })
        .eq("active", true);

      if (cancelled || error || Number(count ?? 0) >= 5000) return;

      setSyncingCities(true);
      const { error: syncError } = await supabase.functions.invoke("sync-brazil-cities", {
        body: {},
      });

      if (!cancelled) {
        setSyncingCities(false);
        if (!syncError) {
          await queryClient.invalidateQueries({ queryKey: ["profile-city-search-v2"] });
        }
        if (syncError) {
          toast({
            title: "Não consegui atualizar as cidades",
            description: "A lista nacional do IBGE será tentada novamente depois.",
            variant: "destructive",
          });
        }
      }
    };

    void ensureBrazilCities();
    return () => {
      cancelled = true;
    };
  }, [user, toast, queryClient]);

  const normalizedCitySearch = normalizeCitySearch(debouncedCitySearch.replace(/\s*-\s*[A-Z]{2}$/i, ""));

  const { data: cityResults = [], isFetching: searchingCities } = useQuery<any[]>({
    queryKey: ["profile-city-search-v2", normalizedCitySearch],
    queryFn: async () => {
      const { data, error } = await db
        .from("cities")
        .select("id,name,state,ibge_code")
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
      const { data, error } = await db.from("retailer_city_availability").select("retailer,status,source_count,notes").eq("city_id", selectedCityId).order("retailer");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedCityId,
  });

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
      setCitySearch(`${city.name} - ${city.state}`);
      setCityPickerOpen(false);
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
      const { data, error } = await supabase.functions.invoke("collect-marilia-flyers", { body: { manual: true } });
      if (error) throw error;
      const report = Array.isArray(data?.report) ? data.report : [];
      setCollectionReport(report);
      const imported = report.filter((r: any) => r.result === "novo importado").length;
      toast({ title: "Coleta concluída", description: imported ? `${imported} novo(s) tabloide(s) enviado(s) para processamento.` : "Nenhum tabloide novo precisou ser importado." });
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
          <p className="font-medium">Tabloides</p>
          <p className="text-xs text-muted-foreground">Digite sua cidade e selecione o município correto. A busca usa a base nacional de municípios do IBGE.</p>

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
                {(searchingCities || syncingCities) && cityResults.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {syncingCities ? "Carregando municípios do IBGE..." : "Buscando cidade..."}
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
              <p className="mt-3 text-xs font-semibold">Redes mapeadas em {selectedCity.name} - {selectedCity.state}</p>
              <div className="mt-2 space-y-1">
                {retailerMap.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Ainda não há redes cadastradas para esta cidade. A descoberta automática de supermercados será conectada na próxima etapa.</p>
                ) : retailerMap.map((entry: any) => (
                  <div key={entry.retailer} className="flex items-center justify-between gap-2 text-xs">
                    <span>{entry.retailer}</span>
                    <span className={entry.status === "available" ? "font-semibold text-emerald-600" : "text-muted-foreground"}>
                      {entry.status === "available" ? "disponível" : "em validação"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button type="button" className="w-full gap-2" onClick={runFlyerCollection} disabled={collecting}>
          {collecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {collecting ? "Executando coleta..." : `Coletar tabloides de ${selectedCity?.name ?? "minha cidade"}`}
        </Button>
        <Button type="button" variant="outline" className="mt-2 w-full gap-2" onClick={() => navigate("/radar?view=import")}><Upload className="h-4 w-4" />Importar ofertas, gôndola ou prints do app</Button>
        {collectionReport && <div className="mt-3 space-y-2">{collectionReport.map((row: any, i: number) => <div key={`${row.retailer}-${i}`} className="rounded-md border p-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium">{row.retailer}</span><span className="text-muted-foreground">{row.result}</span></div>{formatValidity(row.validity?.to) && <p className="mt-1 text-muted-foreground">Validade até {formatValidity(row.validity?.to)}</p>}{row.result === "resumo" && <p className="mt-1 text-muted-foreground">{row.found ?? 0} encontrado(s) · {row.imported ?? 0} novo(s) · {row.unchanged ?? 0} já conhecido(s) · {row.failed ?? 0} falha(s)</p>}{row.error && row.error !== "HTTP 200" && <p className="mt-1 text-destructive">{row.error}</p>}</div>)}</div>}
      </CardContent></Card>
      <Button variant="destructive" className="w-full" onClick={signOut}><LogOut className="h-4 w-4" />Sair da conta</Button>
    </div>
  );
}
