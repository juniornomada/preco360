import { inferPackage, normalizedUnitPrice, type PackageInfo } from "@/lib/flyerAnalysis";

/** Converts catalog metadata to unit prices without modifying recorded prices. */
export function unitPackageFromProduct(
  name:string,
  packageSize:number|string|null|undefined,
  unit:string|null|undefined,
): { pkg:PackageInfo; inferred:boolean } | null {
  const size=Number(packageSize);
  const type=(unit??"").trim().toLowerCase();
  if(Number.isFinite(size) && size>0 && /^(?:g|kg|ml|l|lt|un|und|unid)$/.test(type)){
    const explicit=inferPackage(String(size)+type);
    if(explicit) return {pkg:explicit,inferred:false};
  }
  const named=inferPackage(name);
  // Some NFC-e descriptions show capacity instead of the product's
  // saleable liquid volume (e.g. "SC LIXO 100L", "BALDE 12L").
  // Never report R$/L for the capacity of a non-liquid product.
  const normalizedName=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const isNonLiquidCapacity=/^(?:(?:sc|saco)\s+lixo\b|(?:caixa\s+(?:organizadora|termica)|garrafa\s+termica|lixeira|balde|panela|frigideira|jarra|mop)\b)/.test(normalizedName);
  if(named && !(named.baseUnit==="l" && isNonLiquidCapacity)) {
    return {pkg:named,inferred:false};
  }
  // Certain fiscal receipts shorten package sizes by dropping the unit.
  // Infer only for product families whose physical measure is unambiguous,
  // and only when the number is the final token (not a code/SKU/reference).
  const normalized=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  if(/^oleo(?: de)? soja\b/.test(normalized) &&
      /(?:\s|[.])900\s*$/.test(normalized)){
    const pkg=inferPackage("900ml");
    if(pkg) return {pkg,inferred:true};
  }

  const ambiguousCodeSuffix=/\b(?:cod|codigo|ref|sku|lote)\s*[.:#-]?\s*\d+\s*$/.test(normalized);
  const trailingInteger=normalized.match(/(?:^|[\s.])(\d{2,4})\s*$/);
  if(!ambiguousCodeSuffix && trailingInteger){
    const quantity=Number(trailingInteger[1]);
    const isDryMassFamily=/\bamido(?: de)? milho\b/.test(normalized);
    if(isDryMassFamily && quantity>=50 && quantity<=5000){
      const pkg=inferPackage(String(quantity)+"g");
      if(pkg) return {pkg,inferred:true};
    }
  }
  return null;
}

export function unitPriceForProduct(
  name:string,
  packageSize:number|string|null|undefined,
  unit:string|null|undefined,
  price:number|string|null|undefined,
) {
  const amount=Number(price);
  if(!Number.isFinite(amount)||amount<=0) return null;
  const pack=unitPackageFromProduct(name,packageSize,unit);
  if(!pack) return null;
  const normalized=normalizedUnitPrice(amount,pack.pkg);
  return {...normalized,inferred:pack.inferred,baseQuantity:pack.pkg.baseQuantity};
}
