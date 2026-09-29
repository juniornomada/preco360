import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
const SOURCE_URL = "https://institucional.kawakami.com.br/oferta/marilia";
function cleanUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ""));
    url.hash = "";
    return url.toString();
  } catch {
    return String(value ?? "");
  }
}

function sha256(bytes: Uint8Array) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("")
  );
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(value: string) {
  const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const months: Record<string, number> = {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  };
  return months[key] || 0;
}

function parseValidity(text: string) {
  const first = text.match(
    /OFERTAS\s+V[ÁA]LIDAS\s+DE\s+(\d{1,2})\s+A\s+(\d{1,2})\s+DE\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+)\s+DE\s+(\d{4})/i
  );
  if (first) {
    const month = monthNumber(first[3]);
    if (month) return { from: isoDate(Number(first[4]), month, Number(first[1])), to: isoDate(Number(first[4]), month, Number(first[2])) };
  }
  const second = text.match(
    /OFERTAS\s+V[ÁA]LIDAS\s+DE\s+(\d{1,2})\s+DE\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+)\s+A\s+(\d{1,2})\s+DE\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+)\s+DE\s+(\d{4})/i
  );
  if (second) {
    const m1 = monthNumber(second[2]);
    const m2 = monthNumber(second[4]);
    if (m1 && m2) return { from: isoDate(Number(second[5]), m1, Number(second[1])), to: isoDate(Number(second[5]), m2, Number(second[3])) };
  }
  return { from: null as string | null, to: null as string | null };
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export default {
  async fetch(request: Request) {
    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    let browser: any;
    try {
      const executablePath = await chromium.executablePath();
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1440, height: 1100, deviceScaleFactor: 1 },
        executablePath,
        headless: true,
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
      );
      await page.setExtraHTTPHeaders({ "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" });
      await page.goto(SOURCE_URL, { waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForSelector("a.img-tabloide", { timeout: 12000 }).catch(() => {});

      const meta = await page.evaluate(() => {
        const text = document.body?.innerText || "";
        const links = [...document.querySelectorAll<HTMLAnchorElement>("a.img-tabloide")].map((anchor) => {
          const image = anchor.querySelector("img") as HTMLImageElement | null;
          return {
            href: anchor.href || "",
            imageSrc: image?.currentSrc || image?.src || "",
            alt: image?.alt || "",
          };
        }).filter((item) => item.href || item.imageSrc);
        return { text, links };
      });

      if (!/Ofertas\s*-\s*Mar[ií]lia/i.test(meta.text)) {
        throw new Error("A página renderizada não confirmou Ofertas - Marília");
      }

      const validity = parseValidity(meta.text);
      if (!validity.from || !validity.to) throw new Error("Validade oficial não identificada");

      const unique = [...new Map(meta.links.map((item) => [cleanUrl(item.href || item.imageSrc), item])).values()];
      if (!unique.length) throw new Error("Nenhuma página do tabloide foi encontrada após renderização");

      const now = new Date().toISOString();
      const pages: any[] = [];

      for (let i = 0; i < unique.length; i++) {
        const item = unique[i];
        const target = item.imageSrc || item.href;
        const targetPage = await browser.newPage();
        await targetPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
        );
        try {
          await targetPage.goto(target, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 500));
          const image = await targetPage.$("img");
          const bytes = image
            ? await image.screenshot({ type: "png" })
            : await targetPage.screenshot({ type: "png", fullPage: true });
          const data = new Uint8Array(bytes);
          const hash = await sha256(data);

          pages.push({
            index: i + 1,
            hash,
            source_url: cleanUrl(item.href || item.imageSrc),
            image_source: cleanUrl(item.imageSrc),
            name: item.alt || null,
            mime_type: "image/png",
            size: data.byteLength,
          });
        } finally {
          await targetPage.close().catch(() => {});
        }
      }

      return json({
        retailer: "Kawakami",
        city: "Marília",
        source_url: SOURCE_URL,
        checked_at: now,
        validity,
        rendered: true,
        pages,
      });
    } catch (error) {
      return json({ error: String(error), source_url: SOURCE_URL }, 502);
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};
