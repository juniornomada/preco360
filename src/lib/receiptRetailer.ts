import { canonicalRetailerName } from "@/lib/retailerNames";
import { validateAccessKey } from "@/lib/nfceKey";

/**
 * The same legal company operates multiple banners (including Super Muffato).
 * Never infer the banner from "Irmãos Muffato" alone. A verified full CNPJ
 * identifies a specific store, unlike the shared 8-digit CNPJ root.
 */
const MAX_ATACADISTA_MARILIA_CNPJ = "76430438013826";

function normalizeLegalName(name: string) {
  return name.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function receiptCnpjFromAccessKey(accessKey?: string | null): string | null {
  const key = String(accessKey ?? "").replace(/\D/g, "");
  if (!validateAccessKey(key).valid) return null;
  return key.slice(6, 20);
}

export function canonicalReceiptRetailerName(
  originalName?: string | null,
  cnpj?: string | null,
  accessKey?: string | null,
): string {
  const name = String(originalName ?? "").trim();
  const fallback = canonicalRetailerName(name);
  const statedCnpj = String(cnpj ?? "").replace(/\D/g, "");
  const keyCnpj = receiptCnpjFromAccessKey(accessKey);

  // Conflicting or malformed identifiers must never silently assign a banner.
  if (statedCnpj && statedCnpj.length !== 14) return fallback;
  if (statedCnpj && keyCnpj && statedCnpj !== keyCnpj) return fallback;
  const establishedCnpj = statedCnpj || keyCnpj;

  if (
    establishedCnpj === MAX_ATACADISTA_MARILIA_CNPJ &&
    (/^irmaos muffato\b/.test(normalizeLegalName(name)) ||
      /^max atacadista\b/.test(normalizeLegalName(name)))
  ) {
    return "Max Atacadista";
  }
  return fallback;
}
