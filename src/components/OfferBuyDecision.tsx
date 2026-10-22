import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatNormalizedPrice, type OfferVerdict, type BaseUnit } from "@/lib/flyerAnalysis";
import { historicalReferenceScopeLabel } from "@/lib/referenceBrandScope";

export type BuyDecision = "yes" | "no" | "insufficient";

export function shouldBuyOffer(
  offerNormalizedPrice: number,
  verdict: Pick<OfferVerdict, "referencePrice" | "provenance">,
): BuyDecision {
  const reference = Number(verdict.referencePrice);
  const count = verdict.provenance?.referenceSampleCount ?? 0;
  if (!Number.isFinite(offerNormalizedPrice) || offerNormalizedPrice <= 0 ||
      !Number.isFinite(reference) || reference <= 0 || count < 2)
    return "insufficient";
  return offerNormalizedPrice <= reference ? "yes" : "no";
}

const brl = (amount: number) =>
  amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  normalizedPrice: number;
  packagePrice: number;
  packageBaseQuantity: number | undefined;
  baseUnit: BaseUnit;
  verdict: OfferVerdict;
};

export default function OfferBuyDecision({
  normalizedPrice, packagePrice, packageBaseQuantity, baseUnit, verdict,
}: Props) {
  const [quantity, setQuantity] = useState(1);
  const decision = shouldBuyOffer(normalizedPrice, verdict);
  const scope = verdict.provenance?.referenceScope === "same_brand"
    ? "da mesma marca" : "da categoria";
  const benchmark = Number(verdict.referencePrice);
  const packSize = Number(packageBaseQuantity);
  const canCalculatePackSavings = Number.isFinite(packSize) && packSize > 0 &&
    Number.isFinite(benchmark) && benchmark > 0 && Number.isFinite(packagePrice) &&
    packagePrice > 0;
  const perPackageDifference = canCalculatePackSavings
    ? benchmark * packSize - packagePrice
    : benchmark - packagePrice;
  const diffPct = benchmark > 0 ? ((normalizedPrice - benchmark) / benchmark) * 100 : 0;

  return (
    <div className="mt-3 border-t border-border/50 pt-3">
      <div className="flex items-center justify-start gap-2 whitespace-nowrap">
        <p className="text-xs font-bold text-foreground">Vale a pena comprar?</p>
        <p className={"text-sm font-black " + (
          decision === "yes" ? "text-primary" :
          decision === "no" ? "text-red-500" : "text-muted-foreground"
        )}>
          {decision === "yes" ? "SIM" : decision === "no" ? "NÃO" : "SEM DADOS"}
        </p>
      </div>
      {decision === "insufficient" && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Ainda não há histórico suficiente para recomendar a compra.
        </p>
      )}

      <details className="group mt-2 text-[11px] text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 font-medium [&::-webkit-details-marker]:hidden">
          <span>Ver economia e referência</span>
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90"/>
        </summary>
        <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
          {verdict.referencePrice && verdict.provenance ? (
            <>
              <p>
                Referência {scope}:{" "}
                <strong className="text-foreground">
                  {formatNormalizedPrice(verdict.referencePrice, baseUnit)}
                </strong>
              </p>
              <p>{historicalReferenceScopeLabel(verdict.provenance)}</p>
              {verdict.provenance.referenceScope === "category" && (
                <p>Comparação entre marcas equivalentes, não histórico da marca anunciada.</p>
              )}
              {decision !== "insufficient" && (
                <>
                  <label className="flex items-center justify-between gap-2">
                    <span className="font-semibold">Quantidade de embalagens</span>
                    <input aria-label="Quantidade de embalagens" type="number" min={1} max={99}
                      step={1} inputMode="numeric" value={quantity}
                      onChange={event => {
                        const next = Number(event.target.value);
                        setQuantity(Number.isFinite(next) ? Math.min(99,Math.max(1,Math.trunc(next))) : 1);
                      }}
                      className="h-9 w-16 rounded-lg border border-border bg-background px-2 text-right text-sm font-bold text-foreground"/>
                  </label>
                  <p className="font-semibold text-foreground">
                    {perPackageDifference >= 0 ? "Economia estimada" : "Custo adicional estimado"}:{" "}
                    {brl(Math.abs(perPackageDifference) * quantity)} ({Math.abs(diffPct).toFixed(0)}%)
                  </p>
                  <p>Comparação por {baseUnit === "kg" ? "quilo" : baseUnit === "l" ? "litro" : "unidade"}, usando a referência {scope}.</p>
                </>
              )}
            </>
          ) : (
            <p>Sem histórico anterior comparável disponível.</p>
          )}
        </div>
      </details>
    </div>
  );
}
