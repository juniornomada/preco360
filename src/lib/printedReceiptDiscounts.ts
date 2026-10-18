/**
 * Only discounts explicitly associated with a numbered printed-receipt item
 * may change its effective price. Never allocate an unassigned subtotal rebate.
 * A user always reviews the result before prices are saved.
 */
export type PrintedReceiptItem = {
  name: string;
  price: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  totalPrice?: string;
  itemNumber?: string;
  barcode?: string;
  discountAmount?: string;
  originalUnitPrice?: string;
  originalTotalPrice?: string;
};

export type PrintedReceiptDiscount = {
  itemNumber: string;
  amount: string;
};

function amount(value: string | undefined) {
  if (!value) return null;
  const raw = value.trim();
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function itemNumber(value: string | undefined) {
  const matched = String(value ?? "").trim().match(/^0*(\d{1,4})$/);
  const number = matched ? Number(matched[1]) : NaN;
  return Number.isInteger(number) && number > 0 ? String(number) : null;
}

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

/** Called once after all parts of the same photo/PDF have been merged. */
export function applyPrintedReceiptDiscounts(
  items: PrintedReceiptItem[],
  discounts: PrintedReceiptDiscount[],
) {
  const result = items.map((item) => ({ ...item }));
  const positions = new Map<string, number[]>();

  result.forEach((item, index) => {
    const number = itemNumber(item.itemNumber);
    if (!number) return;
    const existing = positions.get(number) ?? [];
    existing.push(index);
    positions.set(number, existing);
  });

  const grouped = new Map<string, number>();
  const dedup = new Set<string>();
  let unresolved = 0;
  for (const discount of discounts) {
    const number = itemNumber(discount.itemNumber);
    const value = amount(discount.amount);
    if (!number || !value) {
      unresolved += 1;
      continue;
    }
    // An overlapping crop can contain the same printed discount line twice.
    const key = number + ":" + money(value);
    if (dedup.has(key)) continue;
    dedup.add(key);
    grouped.set(number, (grouped.get(number) ?? 0) + value);
  }

  let applied = 0;
  for (const [number, discount] of grouped) {
    const matches = positions.get(number);
    if (!matches || matches.length !== 1) {
      unresolved += 1;
      continue;
    }

    const index = matches[0];
    const item = result[index];
    const quantity = amount(item.quantity);
    const originalUnit = amount(item.unitPrice ?? item.price);
    const totalBefore = originalUnit && quantity
      ? Math.round((originalUnit * quantity + Number.EPSILON) * 100) / 100
      : null;
    // A missing quantity or an ambiguous/greater-than-total discount is unsafe.
    if (!quantity || !originalUnit || !totalBefore ||
        discount >= totalBefore || discount <= 0) {
      unresolved += 1;
      continue;
    }

    const netTotal = Math.round((totalBefore - discount + Number.EPSILON) * 100) / 100;
    const effectiveUnit = netTotal / quantity;
    if (!Number.isFinite(effectiveUnit) || effectiveUnit <= 0) {
      unresolved += 1;
      continue;
    }
    result[index] = {
      ...item,
      originalUnitPrice: money(originalUnit),
      originalTotalPrice: money(totalBefore),
      discountAmount: money(discount),
      price: effectiveUnit.toFixed(6),
      unitPrice: effectiveUnit.toFixed(6),
      totalPrice: money(netTotal),
    };
    applied += 1;
  }
  return { items: result, applied, unresolved };
}
