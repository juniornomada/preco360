import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import PriceChart from "@/components/PriceChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, MapPin, Calendar, DollarSign, Pencil, Check, X, Trash2 } from "lucide-react";

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: product } = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,category,brand,package_size,unit,prices(id,price,date,supermarket)")
        .eq("id", id!)
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!id,
  });

  const startEdit = () => {
    setEditName(product?.name ?? "");
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditName("");
  };

  const saveName = async () => {
    if (!editName.trim() || !id) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("products")
        .update({ name: editName.trim() })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Nome atualizado" });
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["product", id] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async () => {
    if (!user || !id || !product || deleting) return;

    const historyCount = product.prices?.length ?? 0;
    const confirmed = window.confirm(
      `Excluir \"${product.name}\"?\n\n${historyCount > 0 ? `Isso também excluirá ${historyCount} registro(s) de preço do histórico. ` : ""}Essa ação não pode ser desfeita.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["prices"] });
      queryClient.removeQueries({ queryKey: ["product", id] });

      toast({
        title: "Produto excluído",
        description: historyCount > 0
          ? `${product.name} e ${historyCount} registro(s) de preço foram removidos.`
          : `${product.name} foi removido.`,
      });
      navigate("/", { replace: true });
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const prices = product?.prices ?? [];
  const sorted = [...prices].sort((a, b) => b.date.localeCompare(a.date));
  const best = prices.reduce(
    (min, p) => (p.price < min.price ? p : min),
    prices[0] ?? { price: 0, supermarket: "-", date: "" }
  );

  return (
    <div className="page-container">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {editing ? (
            <>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 text-lg font-bold"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") cancelEdit();
                }}
              />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={saveName} disabled={saving}>
                <Check className="h-4 w-4 text-primary" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={cancelEdit}>
                <X className="h-4 w-4 text-muted-foreground" />
              </Button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-bold">{product?.name ?? "Carregando..."}</h1>
                <p className="text-xs text-muted-foreground">{product?.category}</p>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={startEdit}>
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void deleteProduct()}
                disabled={!product || deleting}
                aria-label="Excluir produto"
                title="Excluir produto"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Best price highlight */}
      {prices.length > 0 && (
        <Card className="mb-4 border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4">
            <DollarSign className="h-8 w-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Melhor preço encontrado</p>
              <p className="text-2xl font-bold text-primary">
                R$ {best.price.toFixed(2).replace(".", ",")}
              </p>
              <p className="text-xs text-muted-foreground">@{best.supermarket}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      <div className="mb-4 rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Evolução de Preço</h2>
        <PriceChart
          data={prices.map((p) => ({ date: p.date, price: p.price, supermarket: p.supermarket }))}
        />
      </div>

      {/* Price History */}
      <h2 className="mb-2 text-sm font-semibold">Histórico</h2>
      <div className="space-y-2">
        {sorted.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{p.supermarket}</p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {new Date(p.date).toLocaleDateString("pt-BR")}
                  </div>
                </div>
              </div>
              <p className="font-bold">R$ {p.price.toFixed(2).replace(".", ",")}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
