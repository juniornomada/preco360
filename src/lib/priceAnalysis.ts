export type PriceHistoryPoint = {
  price: number;
  date?: string;
  supermarket?: string;
};

export type PriceVerdict = "exceptional" | "good" | "normal" | "high" | "insufficient";

export interface PriceAnalysis {
  verdict: PriceVerdict;
  label: string;
  message: string;
  historyCount: number;
  min: number;
  max: number;
  average: number;
  median: number;
  lowerQuartile: number;
  upperQuartile: number;
  differenceFromMedianPct: number;
}

const percentile = (sorted: number[], p: number) => {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

export function analyzePrice(currentPrice: number, history: PriceHistoryPoint[]): PriceAnalysis {
  const valid = history
    .map((item) => Number(item.price))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const historyCount = valid.length;
  const min = historyCount ? valid[0] : 0;
  const max = historyCount ? valid[historyCount - 1] : 0;
  const average = historyCount ? valid.reduce((sum, value) => sum + value, 0) / historyCount : 0;
  const median = percentile(valid, 0.5);
  const lowerQuartile = percentile(valid, 0.25);
  const upperQuartile = percentile(valid, 0.75);
  const differenceFromMedianPct = median > 0 ? ((currentPrice - median) / median) * 100 : 0;

  if (historyCount < 2 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      verdict: "insufficient",
      label: "Pouco histórico",
      message: "Registre mais preços deste produto para a análise ficar confiável.",
      historyCount,
      min,
      max,
      average,
      median,
      lowerQuartile,
      upperQuartile,
      differenceFromMedianPct,
    };
  }

  if (currentPrice <= min || currentPrice <= lowerQuartile * 0.97) {
    return {
      verdict: "exceptional",
      label: "Preço excelente",
      message: "Está entre os menores preços do seu histórico. É uma ótima oportunidade de compra.",
      historyCount,
      min,
      max,
      average,
      median,
      lowerQuartile,
      upperQuartile,
      differenceFromMedianPct,
    };
  }

  if (currentPrice <= lowerQuartile || currentPrice < median * 0.98) {
    return {
      verdict: "good",
      label: "Bom preço",
      message: "Está abaixo do preço típico que você costuma encontrar.",
      historyCount,
      min,
      max,
      average,
      median,
      lowerQuartile,
      upperQuartile,
      differenceFromMedianPct,
    };
  }

  if (currentPrice <= upperQuartile) {
    return {
      verdict: "normal",
      label: "Preço normal",
      message: "Está dentro da faixa comum do seu histórico. Compre se estiver precisando.",
      historyCount,
      min,
      max,
      average,
      median,
      lowerQuartile,
      upperQuartile,
      differenceFromMedianPct,
    };
  }

  return {
    verdict: "high",
    label: "Preço alto",
    message: "Está acima da faixa que você costuma pagar. Se puder, vale esperar ou procurar em outro mercado.",
    historyCount,
    min,
    max,
    average,
    median,
    lowerQuartile,
    upperQuartile,
    differenceFromMedianPct,
  };
}

export function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}
