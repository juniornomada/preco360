import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const TEST_URL =
  "https://apigw.cloud.carrefour.com.br/api-middleware-flyer-services/api/v2/Flyer/?id=1mWtF9UHvsqz2qbZNNYYk6cnA7M9tRr37";

export default {
  async fetch() {
    const response = await fetch(TEST_URL);
    if (!response.ok) {
      return Response.json({ status: response.status }, { status: 502 });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pdf = await getDocument({
      data: bytes,
      disableWorker: true,
      useSystemFonts: false,
    } as any).promise;
    const ascii = new TextDecoder("latin1").decode(bytes);
    const regexCount = (ascii.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
    return Response.json({
      status: 200,
      content_type: response.headers.get("content-type"),
      bytes: bytes.length,
      page_count: pdf.numPages,
      regex_page_count: regexCount,
    });
  },
};
