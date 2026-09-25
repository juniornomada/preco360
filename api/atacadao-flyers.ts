const SOURCE_URL = "https://www.atacadao.com.br/loja/marilia";

type Flyer = {
  id: string;
  idThumbnail?: string;
  validity?: { initial?: string; final?: string };
  urlFinalDocument?: string;
  urlFinalDocumentThumbnail?: string;
  name?: string;
  exclude?: boolean;
};

function dateOnly(value?: string | null) {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function currentDateInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function extractStoreInfo(html: string) {
  const marker = '\\"storeInfo\\":';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;

  const start = markerIndex + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end < 0) return null;
  const escapedJson = html.slice(start, end);
  try {
    return JSON.parse(escapedJson.replace(/\\\"/g, '"').replace(/\\\\/g, "\\"));
  } catch {
    return null;
  }
}

function fallbackFlyers(html: string): Flyer[] {
  const blockMatch = html.match(/\\\"flyers\\":(\[[\s\S]*?\])\s*,\\\"dataInauguracao\\\"/);
  if (!blockMatch) return [];
  try {
    return JSON.parse(blockMatch[1].replace(/\\\"/g, '"').replace(/\\\\/g, "\\"));
  } catch {
    return [];
  }
}

export default {
  async fetch() {
    const response = await fetch(SOURCE_URL, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      return Response.json(
        { error: "ATACADAO_SOURCE_UNAVAILABLE", status: response.status },
        { status: 502 },
      );
    }

    const html = await response.text();
    const storeInfo = extractStoreInfo(html);
    const rawFlyers: Flyer[] = Array.isArray(storeInfo?.flyers)
      ? storeInfo.flyers
      : fallbackFlyers(html);

    const today = currentDateInSaoPaulo();
    const flyers = rawFlyers
      .filter((flyer) => flyer && flyer.exclude !== true)
      .map((flyer) => ({
        id: String(flyer.id ?? "").trim(),
        title: String(flyer.name ?? "").trim(),
        valid_from: dateOnly(flyer.validity?.initial),
        valid_to: dateOnly(flyer.validity?.final),
        url: String(flyer.urlFinalDocument ?? "").replace(/\\u0026/g, "&"),
        thumbnail_url: String(flyer.urlFinalDocumentThumbnail ?? "").replace(/\\u0026/g, "&"),
      }))
      .filter(
        (flyer) =>
          flyer.id &&
          flyer.url.includes("/api-middleware-flyer-services/") &&
          !!flyer.valid_to &&
          flyer.valid_to >= today,
      )
      .sort((a, b) =>
        a.valid_to === b.valid_to
          ? a.title.localeCompare(b.title, "pt-BR")
          : String(a.valid_to).localeCompare(String(b.valid_to)),
      );

    return Response.json(
      {
        retailer: "Atacadão",
        city: "Marília",
        source_url: SOURCE_URL,
        store_id: Number(storeInfo?.storeId ?? 630),
        store_name: String(storeInfo?.loja ?? "Marília"),
        checked_on: today,
        flyers,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  },
};
