import { inferPackage, normalizedUnitPrice, type PackageInfo } from "@/lib/flyerAnalysis";
import { resolveReceiptPackage } from "@/lib/receiptPackageResolver";

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

  const resolved=resolveReceiptPackage(name);
  if(!resolved) return null;
  return {
    pkg:resolved.pkg,
    inferred:resolved.source!=="explicit-name",
  };
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
