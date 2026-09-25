const TEST_URL =
  "https://apigw.cloud.carrefour.com.br/api-middleware-flyer-services/api/v2/Flyer/?id=1mWtF9UHvsqz2qbZNNYYk6cnA7M9tRr37";

export default {
  async fetch() {
    const response = await fetch(TEST_URL);
    if (!response.ok) {
      return Response.json({ status: response.status }, { status: 502 });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const ascii = new TextDecoder("latin1").decode(bytes);
    const pageObjects = (ascii.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
    const counts = [...ascii.matchAll(/\/Count\s+(\d+)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0);
    return Response.json({
      status: 200,
      content_type: response.headers.get("content-type"),
      bytes: bytes.length,
      page_objects: pageObjects,
      declared_counts: counts.slice(0, 20),
      inferred_page_count: Math.max(pageObjects, ...counts, 1),
    });
  },
};
