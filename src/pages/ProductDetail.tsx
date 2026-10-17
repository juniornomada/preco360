import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import PriceChart from "@/components/PriceChart";
import { formatNormalizedPrice } from "@/lib/flyerAnalysis";
import { unitPriceForProduct,unitPackageFromProduct } from "@/lib/productUnitPricing";
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
  const [editingReceiptPriceId,setEditingReceiptPriceId]=useState<string|null>(null);
  const [effectivePrice,setEffectivePrice]=useState("");
  const [priceCorrectionReason,setPriceCorrectionReason]=useState("Desconto aplicado no subtotal do cupom fiscal");
  const [savingReceiptPrice,setSavingReceiptPrice]=useState(false);

  const { data: product } = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,category,brand,package_size,unit,prices(id,price,date,supermarket,source,receipt_text)")
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

  const correctImportedReceiptPrice=async(priceId:string)=>{
    if(!user||savingReceiptPrice) return;
    const normalized=Number(effectivePrice.replace(/\s/g,"").replace(/\./g,"").replace(",","."));
    if(!Number.isFinite(normalized)||normalized<=0||!priceCorrectionReason.trim()){
      toast({title:"Informe o preço efetivamente pago e o motivo da correção",variant:"destructive"});
      return;
    }
    setSavingReceiptPrice(true);
    try{
      const {error}=await (supabase as any).rpc("correct_receipt_price_v1",{
        p_price_id:priceId,
        p_effective_price:normalized,
        p_reason:priceCorrectionReason.trim()
      });
      if(error) throw error;
      setEditingReceiptPriceId(null);
      await Promise.all([
        queryClient.invalidateQueries({queryKey:["product",id]}),
        queryClient.invalidateQueries({queryKey:["product-summaries"]}),
        queryClient.invalidateQueries({queryKey:["selected-price-history"]}),
        queryClient.invalidateQueries({queryKey:["prices"]})
      ]);
      toast({title:"Valor efetivamente pago atualizado",description:"O preço original do cupom permanece registrado no histórico de correções."});
    }catch(error:any){
      toast({title:"Não foi possível corrigir o valor",description:error.message,variant:"destructive"});
    }finally{setSavingReceiptPrice(false);}
  };
  const prices = product?.prices ?? [];
  const unitValue=(price:number)=>
    product ? unitPriceForProduct(product.name,product.package_size,product.unit,price) : null;
  const inferredVolume=product && unitPackageFromProduct(product.name,product.package_size,product.unit)?.inferred;
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
              {unitValue(best.price) && (
                  <p className="text-sm font-bold text-primary">
                    {formatNormalizedPrice(unitValue(best.price)!.normalizedPrice,unitValue(best.price)!.baseUnit)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{best.supermarket}</p>
                {inferredVolume && <p className="text-[10px] text-amber-500">Volume inferido da descrição: 900 ml</p>}
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
              <div className="shrink-0 text-right">
                {editingReceiptPriceId===p.id ? (
                  <div className="flex max-w-[200px] flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground" htmlFor={`receipt-amount-${p.id}`}>Valor efetivamente pago (R$)</label>
                    <Input id={`receipt-amount-${p.id}`} inputMode="decimal"
                      value={effectivePrice} onChange={e=>setEffectivePrice(e.target.value)}/>
                    <label className="text-xs text-muted-foreground" htmlFor={`receipt-reason-${p.id}`}>Motivo da alteração</label>
                    <Input id={`receipt-reason-${p.id}`}
                      value={priceCorrectionReason}
                      onChange={e=>setPriceCorrectionReason(e.target.value)}/>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={()=>setEditingReceiptPriceId(null)} disabled={savingReceiptPrice}>Cancelar</Button>
                      <Button size="sm" onClick={()=>void correctImportedReceiptPrice(p.id)} disabled={savingReceiptPrice}>Salvar</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="font-bold">R$ {p.price.toFixed(2).replace(".", ",")}</p>
                    {unitValue(p.price) && (
                      <p className="text-xs font-semibold text-primary">
                        {formatNormalizedPrice(unitValue(p.price)!.normalizedPrice,unitValue(p.price)!.baseUnit)}
                      </p>
                    )}
                    {p.source==="receipt" && (
                      <>
                        <Button size="sm" variant="outline" className="mt-1 h-7"
                          onClick={()=>{setEditingReceiptPriceId(p.id);setEffectivePrice(p.price.toFixed(2).replace(".",","));}}>
                          <Pencil className="mr-1 h-3 w-3"/>Editar valor pago
                        </Button>
                        {p.receipt_text?.match(/total do item\s+([\d.,]+)/i)?.[1] && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Valor original do cupom: R$ {p.receipt_text.match(/total do item\s+([\d.,]+)/i)?.[1]?.replace(".",",")}
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
