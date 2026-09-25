import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const PROFILE_URL = "https://www.flipsnack.com/taustesupermercado/";
const PROFILE_API = "https://api.flipsnack.com/v2/publications/related";
const ACCOUNT_ID = "9D99E5AF8D6";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function collectionHash(publication: any) {
  const direct = String(publication?.directLink ?? "");
  const directMatch = direct.match(/-([a-z0-9_-]{8,})\.html(?:$|[?#])/i);
  if (directMatch?.[1]) return directMatch[1];

  const cover = String(publication?.coverImgSrc ?? "");
  return cover.match(/\/collections\/([^/]+)\//i)?.[1] ?? "";
}

function fullViewUrl(publication: any) {
  const direct = String(publication?.directLink ?? "").trim();
  if (!direct) return PROFILE_URL;
  return (
    PROFILE_URL +
    direct.replace(/\.html(?:$|[?#])/i, "/full-view.html")
  );
}

async function officialPublications() {
  const url = new URL(PROFILE_API);
  url.searchParams.set("p", "1");
  url.searchParams.set("accountId", ACCOUNT_ID);
  url.searchParams.set("excludeId", "0");
  url.searchParams.set("userUrl", PROFILE_URL);
  url.searchParams.set("folderHash", "");
  url.searchParams.set("searchAfter", "0");
  url.searchParams.set("searchKey", "");

  const response = await fetch(url, {
    headers: {
      "user-agent": BROWSER_UA,
      accept: "application/json,*/*",
      referer: PROFILE_URL,
    },
  });
  if (!response.ok) throw new Error("PROFILE_HTTP_" + response.status);

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("PROFILE_FORMAT_INVALID");

  return data.filter((publication: any) => {
    const name = normalize(publication?.name);
    return (
      name.includes("ofertas tauste") &&
      name.includes("marilia") &&
      collectionHash(publication)
    );
  });
}

async function resolveInBrowser(browser: any, publication: any) {
  const hash = collectionHash(publication);
  const sourceUrl = fullViewUrl(publication);
  const page = await browser.newPage();

  try {
    await page.setUserAgent(BROWSER_UA);
    await page.setExtraHTTPHeaders({
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
    });

    const dataResponsePromise = page.waitForResponse(
      (response: any) => {
        const url = response.url();
        return (
          response.status() === 200 &&
          url.includes(
            "/" + ACCOUNT_ID + "/collections/" + hash + "/data.json?",
          )
        );
      },
      { timeout: 45_000 },
    );

    const navigation = await page.goto(sourceUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (navigation && navigation.status() >= 400) {
      throw new Error("PUBLICATION_HTTP_" + navigation.status());
    }

    const dataResponse = await dataResponsePromise;
    const dataUrl = new URL(dataResponse.url());
    const signature = dataUrl.search.slice(1);
    if (!signature) throw new Error("SIGNED_DATA_URL_MISSING");

    const data = await dataResponse.json();
    const title = String(data?.properties?.title ?? "").trim();
    if (!normalize(title).includes("marilia")) {
      throw new Error("PUBLICATION_NOT_MARILIA");
    }

    const order = Array.isArray(data?.pages?.order)
      ? data.pages.order.flat()
      : [];

    const pages = order
      .map((pageId: unknown, index: number) => {
        const id = String(pageId ?? "").trim();
        if (!id) return null;
        const pageData = data?.pages?.data?.[id] ?? {};
        const coverVersion = Number(pageData?.coverVersion) || 1;

        return {
          id,
          position: index + 1,
          url:
            "https://d3u72tnj701eui.cloudfront.net/" +
            ACCOUNT_ID +
            "/collections/" +
            hash +
            "/covers/" +
            encodeURIComponent(id) +
            "/original?" +
            signature +
            "&v=" +
            coverVersion,
          type: String(pageData?.type ?? "jpg"),
          width: Number(pageData?.width) || null,
          height: Number(pageData?.height) || null,
        };
      })
      .filter(Boolean);

    if (!pages.length) throw new Error("PUBLICATION_WITHOUT_PAGES");

    return {
      collection_hash: hash,
      title: title || String(publication?.name ?? "Ofertas Tauste Marília"),
      source_url: sourceUrl,
      published_at: String(publication?.datePublished ?? "") || null,
      updated_at: Number(data?.properties?.dateLastUpdate) || null,
      page_count: pages.length,
      pages,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export default {
  async fetch() {
    let browser: any = null;

    try {
      const publications = await officialPublications();
      if (!publications.length) {
        return Response.json(
          {
            retailer: "Tauste",
            city: "Marília",
            source_url: PROFILE_URL,
            checked_at: new Date().toISOString(),
            flyers: [],
          },
          { headers: { "cache-control": "no-store" } },
        );
      }

      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1280, height: 960 },
        executablePath: await chromium.executablePath(),
        headless: true,
      });

      const flyers = [];
      for (const publication of publications) {
        flyers.push(await resolveInBrowser(browser, publication));
      }

      return Response.json(
        {
          retailer: "Tauste",
          city: "Marília",
          source_url: PROFILE_URL,
          checked_at: new Date().toISOString(),
          flyers,
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      console.error("tauste-flyers", error);
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  },
};
