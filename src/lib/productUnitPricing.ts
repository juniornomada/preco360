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
  if(named) return {pkg:named,inferred:false};
  // Certain fiscal receipts shorten ordinary 900-ml soybean oil bottles as
  // "OLEO SOJA ... .900". Other unit-less figures remain unclassified.
  const normalized=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  if(/^oleo(?: de)? soja\b/.test(normalized) &&
      /(?:\s|[.])900\s*$/.test(normalized)){
    const pkg=inferPackage("900ml");
    if(pkg) return {pkg,inferred:true};
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
