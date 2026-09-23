export function canonicalRetailerName(value?: string | null) {
  const original = String(value ?? "").trim();
  if (!original) return original;

  const normalized = original
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (
    normalized === "supermercados kawakami" ||
    normalized === "supermercado kawakami" ||
    normalized === "kawakami"
  ) {
    return "Kawakami";
  }

  if (
    normalized === "confianca supermercados" ||
    normalized === "supermercados confianca" ||
    normalized === "supermercado confianca" ||
    normalized === "confianca"
  ) {
    return "Confiança";
  }

  return original;
}
