import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const db = supabase as any;

const dateBr = (value?: string | null) => {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

export default function FlyerHistoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: flyers = [], isLoading } = useQuery<any[]>({
    queryKey: ["flyers-manage", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("flyers")
        .select("id,retailer,valid_from,valid_to,source_file_name,source_file_path,created_at,flyer_items(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const removeFlyer = async (flyer: any) => {
    if (!window.confirm(`Excluir o tabloide de ${flyer.retailer}? Os preços ofertados dele também serão removidos.`)) return;
    setDeletingId(flyer.id);
    try {
      if (flyer.source_file_path) {
        const { error: storageError } = await supabase.storage.from("flyers").remove([flyer.source_file_path]);
        if (storageError) console.warn("Não foi possível remover o arquivo do storage:", storageError.message);
      }

      const { error } = await db.from("flyers").delete().eq("id", flyer.id);
      if (error) throw error;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["flyers"] }),
        queryClient.invalidateQueries({ queryKey: ["flyers-manage"] }),
        queryClient.invalidateQueries({ queryKey: ["flyer-item-history"] }),
      ]);
      toast({ title: "Tabloide excluído", description: "O histórico ofertado dessa importação foi removido." });
    } catch (error: any) {
      toast({ title: "Não foi possível excluir", description: error?.message ?? "Tente novamente.", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="page-container mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Button asChild size="icon" variant="outline" aria-label="Voltar para Ofertas">
          <Link to="/offers"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Radar 360</p>
          <h1 className="text-2xl font-extrabold tracking-tight">Gerenciar tabloides</h1>
          <p className="text-sm text-muted-foreground">Exclua importações de teste ou dados incorretos.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !flyers.length ? (
        <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">Nenhum tabloide salvo.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {flyers.map((flyer) => (
            <Card key={flyer.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><FileText className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{flyer.retailer}</p>
                  <p className="text-xs text-muted-foreground">{dateBr(flyer.valid_from)} → {dateBr(flyer.valid_to)} · {flyer.flyer_items?.[0]?.count ?? 0} ofertas</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{flyer.source_file_name || "Tabloide"}</p>
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0 text-destructive"
                  disabled={deletingId === flyer.id}
                  onClick={() => void removeFlyer(flyer)}
                  aria-label="Excluir tabloide"
                >
                  {deletingId === flyer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
