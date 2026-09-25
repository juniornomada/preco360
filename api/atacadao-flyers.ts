const SOURCE_URL = "https://www.atacadao.com.br/loja/marilia";

function decodeUrl(value: string) {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
}

function unique(values: string[]) {
  return [...new Set(values)];
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

    const html = await response.text();

    const finalDocuments = unique(
      [...html.matchAll(/"urlFinalDocument"\s*:\s*"([^"]+)"/g)].map((match) =>
        decodeUrl(match[1]),
      ),
    );

    const apiFlyers = unique(
      [...html.matchAll(/https?:\\?\/\\?\/[^"'<>\\s]*api-middleware-flyer-services[^"'<>\\s]*/gi)]
        .map((match) => decodeUrl(match[0])),
    );

    const nearby: string[] = [];
    for (const url of finalDocuments.slice(0, 20)) {
      const index = html.indexOf(url.replace(/&/g, "\\u0026"));
      if (index >= 0) {
        nearby.push(html.slice(Math.max(0, index - 1200), Math.min(html.length, index + 1800)));
      }
    }

    return Response.json({
      source: SOURCE_URL,
      status: response.status,
      contentType: response.headers.get("content-type"),
      htmlLength: html.length,
      hasMarilia: /mar[ií]lia/i.test(html),
      hasFlyerSection: /(folheto|encarte|flyer)/i.test(html),
      finalDocuments,
      apiFlyers,
      nearby,
    });
  },
};
