import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifiedPackageFromInput } from "@/lib/verifiedProductPackage";

type PackageProduct = {
  id: string;
  name: string;
};

/**
 * User-verified packaging data only: no guess based on a truncated NFC-e
 * description. Stores metadata on the owner's product, never modifies prices.
 */
export default function QuotePackageCorrection({ product }: { product: PackageProduct }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const verified = verifiedPackageFromInput(size, unit);

  const save = async () => {
    if (!verified || !user || saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .update(verified)
        .eq("id", product.id)
        .eq("user_id", user.id)
        .select("id")
        .single();
      if (error) throw error;
      if (!data?.id) throw new Error("Produto não encontrado para atualização.");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["product-summaries", user.id] }),
        queryClient.invalidateQueries({ queryKey: ["product", product.id] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
      setExpanded(false);
      setSize("");
      setUnit("");
      toast({
        title: "Embalagem confirmada",
        description: "A comparação por kg/L foi atualizada sem alterar os preços históricos.",
      });
    } catch (err: any) {
      toast({
        title: "Não foi possível atualizar a embalagem",
        description: String(err?.message ?? "Tente novamente."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/35 bg-amber-500/5 p-3">
      <p className="text-sm font-semibold text-foreground">
        Peso ou volume não identificado
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        A descrição da nota fiscal não informa com segurança a quantidade da embalagem.
        Confira o rótulo para habilitar uma comparação por kg ou litro.
        Os preços já registrados não serão alterados.
      </p>
      {!expanded ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 min-h-10"
          onClick={() => setExpanded(true)}
        >
          Informar peso/volume da embalagem
        </Button>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-[1fr_112px] gap-2">
            <div>
              <label htmlFor="quote-package-size" className="mb-1 block text-xs font-medium text-muted-foreground">
                Quantidade na embalagem
              </label>
              <Input
                id="quote-package-size"
                value={size}
                onChange={(event) => setSize(event.target.value)}
                placeholder="Ex.: 500"
                inputMode="decimal"
              />
            </div>
            <div>
              <label htmlFor="quote-package-unit" className="mb-1 block text-xs font-medium text-muted-foreground">
                Unidade
              </label>
              <select
                id="quote-package-unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                <option value="">Selecione</option>
                <option value="g">g</option>
                <option value="kg">kg</option>
                <option value="ml">ml</option>
                <option value="l">L</option>
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Ex.: 500 g, 1 kg, 900 ml ou 1,5 L. Não use a quantidade comprada (2 UN, 3 UN etc.).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!verified || saving} onClick={() => void save()}>
              {saving ? "Salvando..." : "Salvar embalagem"}
            </Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setExpanded(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
