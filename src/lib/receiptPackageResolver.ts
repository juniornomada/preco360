import {
  inferPackage,
  isCapacitySpecificationProduct,
  type PackageInfo,
} from "@/lib/flyerAnalysis";

export type ReceiptPackageResolutionSource =
  | "explicit-name"
  | "sale-unit"
  | "verified-rule"
  | "family-suffix";

export type ReceiptPackageResolution = {
  pkg: PackageInfo;
  source: ReceiptPackageResolutionSource;
  confidence: "high" | "fallback";
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9,.x]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function packageFrom(quantity: number, unit: "g" | "kg" | "ml" | "l" | "un") {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return inferPackage(`${quantity}${unit}`);
}

/**
 * Product descriptions can contain capacities that are not the quantity
 * consumed/sold (e.g. trash bag 100 L, bucket 12 L). Never use those
 * capacities to calculate R$/L.
 */
export function isReceiptCapacityName(name: string) {
  const text = normalize(name);
  return (
    isCapacitySpecificationProduct(name) ||
    /^(?:sc|saco) lixo(?: |$)/.test(text) ||
    /^(?:lixeira|balde|jarra|garrafa termica|caixa termica)(?: |$)/.test(text)
  );
}

function hasFiscalCodeSuffix(text: string) {
  return /\b(?:cod|codigo|ref|sku|lote)\s*[.:#-]?\s*\d+\s*$/.test(text);
}

function trailingNumber(text: string) {
  const direct = text.match(/(?:^|[\s.])(\d{1,5}(?:[.,]\d{1,3})?)\s*$/);
  const beforeContainer = text.match(
    /(?:^|[\s.])(\d{1,5}(?:[.,]\d{1,3})?)\s+(?:pt|pote|pct|pacote|pc|bd|band|cx|caixa)\s*$/,
  );
  // Retail fiscal abbreviations also concatenate the container and quantity,
  // e.g. "BAND300". Family guards below decide whether that terminal number
  // can actually represent mass/volume.
  const attached = text.match(/(\d{2,5})\s*$/);
  const match = direct ?? beforeContainer ?? attached;
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function fallbackSaleUnit(unit: string | null | undefined) {
  const saleUnit = String(unit ?? "").trim().toUpperCase();
  if (saleUnit === "KG") return packageFrom(1, "kg");
  if (saleUnit === "G") return packageFrom(1, "g");
  if (saleUnit === "L" || saleUnit === "LT") return packageFrom(1, "l");
  if (saleUnit === "ML") return packageFrom(1, "ml");

  // These are sale/package units, not physical mass/volume. R$/un is an
  // honest fallback when the receipt has no reliable package dimension.
  if (
    [
      "UN",
      "UND",
      "UNID",
      "PC",
      "PÇ",
      "PCT",
      "PT",
      "CX",
      "FD",
      "FR",
      "BD",
      "RL",
      "DZ",
      "JG",
      "KIT",
    ].includes(saleUnit)
  ) {
    return packageFrom(1, "un");
  }

  return null;
}

/**
 * Resolves package metadata from fiscal descriptions conservatively.
 * Stronger physical evidence (g/kg/ml/L) always wins over sale-unit fallback.
 */
export function resolveReceiptPackage(
  name: string,
  saleUnit?: string | null,
): ReceiptPackageResolution | null {
  const text = normalize(name);
  if (!text) return null;

  const capacityOnly = isReceiptCapacityName(name);

  if (!capacityOnly) {
    const explicit = inferPackage(name);
    if (explicit && explicit.quantity > 0) {
      return {
        pkg: explicit,
        source: "explicit-name",
        confidence: "high",
      };
    }

    // Fiscal descriptions often end only in "UN", without a leading "1".
    if (/(?:^|\s)un\s*$/.test(text)) {
      const pkg = packageFrom(1, "un");
      if (pkg) return { pkg, source: "explicit-name", confidence: "high" };
    }
  }

  // Verified recurring fiscal descriptions.
  if (/^massa (?:p |para |de )?pastel da feira$/.test(text)) {
    const pkg = packageFrom(1, "kg");
    if (pkg) return { pkg, source: "verified-rule", confidence: "high" };
  }

  // Current Tauste catalog identifies these exact abbreviated receipt items
  // as a 150 g broccoli piece and a 500 g Arra 15 grape tray.
  if (/^brocolis japon ninja$/.test(text)) {
    const pkg = packageFrom(150, "g");
    if (pkg) return { pkg, source: "verified-rule", confidence: "high" };
  }
  if (/^uva arra 15 s sement$/.test(text)) {
    const pkg = packageFrom(500, "g");
    if (pkg) return { pkg, source: "verified-rule", confidence: "high" };
  }

  // Known retailer abbreviation: "MILHO VD.FERN.BD.00G" represents the
  // owner-verified 600 g in-natura tray.
  if (/^milho (?:vd|verde).*fern.*bd[ .]?00g$/.test(text)) {
    const pkg = packageFrom(600, "g");
    if (pkg) return { pkg, source: "verified-rule", confidence: "high" };
  }

  // Some receipts abbreviate 1,25 kg as "1,25k". Require a decimal compact
  // suffix to avoid confusing model codes ending in "K".
  const compactKg = text.match(/(?:^|\s)(\d{1,2}[,.]\d{1,3})k$/);
  if (compactKg) {
    const value = Number(compactKg[1].replace(",", "."));
    if (value > 0 && value <= 20) {
      const pkg = packageFrom(value, "kg");
      if (pkg) return { pkg, source: "family-suffix", confidence: "high" };
    }
  }

  // Fermented milk multipacks are frequently truncated as "6X80".
  const unitlessMultipack = text.match(/\b(\d{1,2})\s*x\s*(\d{2,4})$/);
  if (
    unitlessMultipack &&
    /\b(?:leite ferm|yakult)\b/.test(text)
  ) {
    const count = Number(unitlessMultipack[1]);
    const each = Number(unitlessMultipack[2]);
    if (count >= 2 && count <= 24 && each >= 40 && each <= 500) {
      const pkg = packageFrom(count * each, "ml");
      if (pkg) return { pkg, source: "family-suffix", confidence: "high" };
    }
  }

  if (!capacityOnly && !hasFiscalCodeSuffix(text)) {
    const quantity = trailingNumber(text);

    if (quantity != null) {
      // Dry/solid grocery families commonly lose only the final unit in
      // NFC-e descriptions: "... 500" means 500 g, not an arbitrary code.
      const dryMassFamily =
        /\b(?:amido(?: de)? milho|bisc(?:uito)?|bolacha|cafe sol|leite cond|manteiga|mant |margarina|farinha|far |fermento|ferm |milho pip|pipoca|pao forma|pao de forma|bombom|cereal|farofa|goiabada|quiabo)\b/.test(
          text,
        );
      if (dryMassFamily && quantity >= 10 && quantity <= 5000) {
        const pkg = packageFrom(quantity, "g");
        if (pkg) return { pkg, source: "family-suffix", confidence: "high" };
      }

      // Soybean oil is commonly shortened to ".900".
      if (/^oleo(?: de)? soja\b/.test(text) && quantity >= 100 && quantity <= 5000) {
        const pkg = packageFrom(quantity, "ml");
        if (pkg) return { pkg, source: "family-suffix", confidence: "high" };
      }

      // Cleaning liquids may be abbreviated as "... 5" (5 L) or "... 500"
      // (500 ml). Restrict to liquid product families.
      const liquidFamily =
        /\b(?:desinf(?:etante)?|agua sanitaria|lava louca|detergente|amaciante|refrigerante|refri|suco|leite liq|iog liq|molho)\b/.test(
          text,
        );
      if (liquidFamily) {
        if (quantity >= 50 && quantity <= 10000) {
          const pkg = packageFrom(quantity, "ml");
          if (pkg) return { pkg, source: "family-suffix", confidence: "high" };
        }
        if (quantity >= 1 && quantity <= 20) {
          const pkg = packageFrom(quantity, "l");
          if (pkg) return { pkg, source: "family-suffix", confidence: "high" };
        }
      }
    }
  }

  const saleFallback = fallbackSaleUnit(saleUnit);
  if (saleFallback) {
    return {
      pkg: saleFallback,
      source: "sale-unit",
      confidence:
        saleFallback.baseUnit === "un" ? "fallback" : "high",
    };
  }

  return null;
}

function unitLabel(unit: PackageInfo["unit"]) {
  return unit === "l" ? "L" : unit;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(value);
}

/**
 * Adds the resolved physical package to a product name without duplicating the
 * numeric suffix already present in fiscal descriptions.
 */
export function nameWithPhysicalPackage(
  name: string,
  packageSize: number | string | null | undefined,
  unit: string | null | undefined,
) {
  const size = Number(packageSize);
  const normalizedUnit = String(unit ?? "").trim().toLowerCase();

  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    !["g", "kg", "ml", "l", "lt"].includes(normalizedUnit)
  ) {
    return name;
  }

  const physicalUnit = normalizedUnit === "lt" ? "l" : normalizedUnit;

  // Improve fiscal abbreviations where the unit was glued to the previous
  // word, e.g. "BOV.RESFkg" -> "BOV.RESF kg".
  if (
    physicalUnit === "kg" &&
    /([a-zá-ú]{3,})kg\s*$/i.test(name)
  ) {
    return name.replace(/([a-zá-ú]{3,})kg\s*$/i, "$1 kg");
  }
  if (
    physicalUnit === "ml" &&
    /([a-zá-ú]{3,})ml\s*$/i.test(name)
  ) {
    return name.replace(/([a-zá-ú]{3,})ml\s*$/i, "$1 ml");
  }

  const existing = !isReceiptCapacityName(name) ? inferPackage(name) : null;
  if (
    existing &&
    existing.baseUnit !== "un" &&
    Math.abs(existing.quantity - size) < 0.0001
  ) {
    return name;
  }

  // Normalize compact kg abbreviation: 1,25k -> 1,25kg.
  if (
    physicalUnit === "kg" &&
    /\d{1,2}[,.]\d{1,3}k\s*$/i.test(name)
  ) {
    return name.replace(/k\s*$/i, "kg");
  }

  // Correct the known malformed 600 g fiscal abbreviation.
  if (
    physicalUnit === "g" &&
    size === 600 &&
    /milho\s+(?:vd|verde).*fern.*bd[ .]?00g\s*$/i.test(
      name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    )
  ) {
    return name.replace(/00g\s*$/i, "600g");
  }

  const multipack = name.match(/(\d{1,2})\s*[xX]\s*(\d{2,4})\s*$/);
  if (multipack) {
    const count = Number(multipack[1]);
    const each = Number(multipack[2]);
    if (Math.abs(count * each - size) < 0.0001) {
      return name.replace(
        /(\d{1,2})\s*[xX]\s*(\d{2,4})\s*$/,
        `$1X$2${unitLabel(physicalUnit as PackageInfo["unit"])}`,
      );
    }
  }

  const trailing = name.match(/(\d{1,5}(?:[.,]\d{1,3})?)\s*$/);
  if (trailing) {
    const trailingValue = Number(trailing[1].replace(",", "."));
    if (Math.abs(trailingValue - size) < 0.0001) {
      return name.replace(
        /(\d{1,5}(?:[.,]\d{1,3})?)\s*$/,
        `$1${unitLabel(physicalUnit as PackageInfo["unit"])}`,
      );
    }
  }

  const beforeContainer = name.match(
    /(\d{1,5}(?:[.,]\d{1,3})?)\s+(PT|POTE|PCT|PACOTE|PC|BD|BAND|CX|CAIXA)\s*$/i,
  );
  if (beforeContainer) {
    const packageValue = Number(beforeContainer[1].replace(",", "."));
    if (Math.abs(packageValue - size) < 0.0001) {
      return name.replace(
        /(\d{1,5}(?:[.,]\d{1,3})?)\s+(PT|POTE|PCT|PACOTE|PC|BD|BAND|CX|CAIXA)\s*$/i,
        `$1${unitLabel(physicalUnit as PackageInfo["unit"])} $2`,
      );
    }
  }

  return `${name.trim()} ${formatQuantity(size)}${unitLabel(
    physicalUnit as PackageInfo["unit"],
  )}`;
}
