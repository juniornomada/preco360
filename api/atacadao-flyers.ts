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

function extractFlyers(html: string): Flyer[] {
  const rows: Flyer[] = [];
  const re = /"id":"([^"]+)"[\s\S]{0,1200}?"validity":\{"initial":"([^"]+)","final":"([^"]+)"\}[\s\S]{0,1200}?"urlFinalDocument":"([^"]+)"[\s\S]{0,900}?"urlFinalDocumentThumbnail":"([^"]+)"[\s\S]{0,900}?"name":"([^"]+)"/g;

  for (const match of html.matchAll(re)) {
    rows.push({
      id: match[1],
      validity: { initial: match[2], final: match[3] },
      urlFinalDocument: match[4],
      urlFinalDocumentThumbnail: match[5],
      name: match[6],
      exclude: false,
    });
  }
  return rows;
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
    const rawFlyers = extractFlyers(html);

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
        store_id: 630,
        store_name: "Marília",
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
