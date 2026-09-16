import { inferPackage, type PackageInfo } from "@/lib/flyerAnalysis";

function unitInfo(quantity: number, rawUnit: string): PackageInfo | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const unit = rawUnit.toLowerCase();
  if (["g", "grama", "gramas"].includes(unit)) {
    return { quantity, unit: "g", baseUnit: "kg", baseQuantity: quantity / 1000 };
  }
  if (["kg", "quilo", "quilos"].includes(unit)) {
    return { quantity, unit: "kg", baseUnit: "kg", baseQuantity: quantity };
  }
  if (unit === "ml") {
    return { quantity, unit: "ml", baseUnit: "l", baseQuantity: quantity / 1000 };
  }
  if (["l", "lt", "litro", "litros"].includes(unit)) {
    return { quantity, unit: "l", baseUnit: "l", baseQuantity: quantity };
  }
  if (["un", "und", "unid", "unidade", "unidades"].includes(unit)) {
    return { quantity, unit: "un", baseUnit: "un", baseQuantity: quantity };
  }
  return null;
}

function decimalNumber(intPart: string, decimalPart: string) {
  return Number(`${intPart}.${decimalPart}`);
}

/**
 * Package parser used by flyer OCR. It handles decimal quantities before the
 * generic text normalizer can split comma/dot decimals (e.g. 1,35 L).
 */
export function inferFlyerPackage(value: string): PackageInfo | null {
  const text = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const multiDecimal = text.match(/\b(\d+)\s*x\s*(\d+)\s*[,\.]\s*(\d+)\s*(kg|g|grama|gramas|ml|l|lt|litro|litros)\b/i);
  if (multiDecimal) {
    const each = decimalNumber(multiDecimal[2], multiDecimal[3]);
    const eachInfo = unitInfo(each, multiDecimal[4]);
    if (eachInfo) {
      const count = Number(multiDecimal[1]);
      return unitInfo(eachInfo.quantity * count, eachInfo.unit);
    }
  }

  const decimal = text.match(/\b(\d+)\s*[,\.]\s*(\d+)\s*(kg|quilo|quilos|g|grama|gramas|ml|l|lt|litro|litros|un|und|unid|unidade|unidades)\b/i);
  if (decimal) {
    const parsed = unitInfo(decimalNumber(decimal[1], decimal[2]), decimal[3]);
    if (parsed) return parsed;
  }

  return inferPackage(value);
}
