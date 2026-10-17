/** Correct only the effective paid unit price, never the original NFC-e item data. */
export function parsedPaidPrice(value: string): number | null {
  const trimmed=value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(trimmed)) return null;
  const price=Number(trimmed.replace(",","."));
  return Number.isFinite(price) && price>0 && price<100000 ? Math.round(price*100)/100 : null;
}

export function correctedPriceMetadata(
  previous: {
    price: number;
    receipt_original_price?: number | null;
    normalized_price?: number | null;
    base_unit?: string | null;
  },
  effectivePaid: number,
  productNormalized?: {normalizedPrice:number;baseUnit:string}|null
) {
  const existingUnit=Number(previous.normalized_price);
  const before=Number(previous.price);
  const normalized = previous.normalized_price != null &&
    Number.isFinite(existingUnit) && existingUnit>0 && before>0
    ? Number((existingUnit*effectivePaid/before).toFixed(6))
    : productNormalized?.normalizedPrice ?? null;
  return {
    price: effectivePaid,
    receipt_original_price: previous.receipt_original_price ?? before,
    normalized_price: normalized,
    base_unit: previous.base_unit ?? productNormalized?.baseUnit ?? null,
  };
}
