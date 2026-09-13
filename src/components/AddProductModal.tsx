import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = ["Geral", "Alimentos", "Bebidas", "Limpeza", "Higiene", "Hortifruti", "Carnes", "Laticínios", "Padaria"];

interface AddProductModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export default function AddProductModal({ open, onClose, onAdded }: AddProductModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Geral");
  const [price, setPrice] = useState("");
  const [supermarket, setSupermarket] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      // Create or find product
      const { data: product, error: pErr } = await supabase
        .from("products")
        .insert({ name, category, user_id: user.id })
        .select()
        .single();
      if (pErr) throw pErr;

      const { error: prErr } = await supabase.from("prices").insert({
        product_id: product.id,
        supermarket,
        price: parseFloat(price.replace(",", ".")),
        date,
        user_id: user.id,
      });
      if (prErr) throw prErr;

      toast({ title: "Produto adicionado!", description: `${name} salvo com sucesso.` });
      onAdded();
      onClose();
      setName("");
      setPrice("");
      setSupermarket("");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Produto</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nome do Produto</Label>
            <Input placeholder="Ex: Arroz 5kg" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Preço (R$)</Label>
              <Input placeholder="10,50" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Supermercado</Label>
            <Input placeholder="Ex: Supermercado A" value={supermarket} onChange={(e) => setSupermarket(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
