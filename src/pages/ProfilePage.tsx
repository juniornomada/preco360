import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const db = supabase as any;
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, Laptop, Loader2, LogOut, Moon, Package, RefreshCw, Store, Sun, Upload } from "lucide-react";

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [collecting, setCollecting] = useState(false);
  const [collectionReport, setCollectionReport] = useState<any[] | null>(null);
  const [selectedCityId, setSelectedCityId] = useState("");
  const [savingCity, setSavingCity] = useState(false);

  const { data: cities = [] } = useQuery<any[]>({
    queryKey: ["profile-cities-v1"],
    queryFn: async () => {
      const { data, error } = await db.from("cities").select("id,name,state").eq("active", true).order("state").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

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
    if (cityPreference?.city_id) setSelectedCityId(cityPreference.city_id);
    else if (cities.length) {
      const marilia = cities.find((city: any) => city.name === "Marília" && city.state === "SP");
      if (marilia) setSelectedCityId(marilia.id);
    }
  }, [cityPreference?.city_id, cities]);

  const selectedCity = cities.find((city: any) => city.id === selectedCityId) ?? null;

  const { data: retailerMap = [] } = useQuery<any[]>({
    queryKey: ["profile-retailer-city-map-v1", selectedCityId],
    queryFn: async () => {
      const { data, error } = await db.from("retailer_city_availability").select("retailer,status,source_count,notes").eq("city_id", selectedCityId).order("retailer");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedCityId,
  });

  const saveCity = async (cityId: string) => {
    if (!user || !cityId) return;
    setSavingCity(true);
    try {
      const { error } = await db.from("user_city_preferences").upsert({ user_id: user.id, city_id: cityId }, { onConflict: "user_id" });
      if (error) throw error;
      setSelectedCityId(cityId);
      toast({ title: "Cidade atualizada", description: "O Radar agora usa esta cidade como referência." });
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
          <p className="text-xs text-muted-foreground">Escolha sua cidade. O Radar mostra as redes mapeadas para essa localidade e usa as fontes oficiais cadastradas.</p>
          <select className="mt-3 h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedCityId} onChange={(event) => void saveCity(event.target.value)} disabled={savingCity || cities.length === 0}>
            {cities.map((city: any) => <option key={city.id} value={city.id}>{city.name} - {city.state}</option>)}
          </select>
          {selectedCity && <div className="mt-3 rounded-md border p-3"><p className="text-xs font-semibold">Redes mapeadas em {selectedCity.name} - {selectedCity.state}</p><div className="mt-2 space-y-1">
            {retailerMap.length === 0 ? <p className="text-xs text-muted-foreground">Ainda não há redes cadastradas para esta cidade.</p> : retailerMap.map((entry: any) => <div key={entry.retailer} className="flex items-center justify-between gap-2 text-xs"><span>{entry.retailer}</span><span className={entry.status === "available" ? "font-semibold text-emerald-600" : "text-muted-foreground"}>{entry.status === "available" ? "disponível" : "em validação"}</span></div>)}
          </div></div>}
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
