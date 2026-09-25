const SOURCE_URL = "https://www.maxatacadista.com.br/lojas/";

function uniq<T>(values: T[]) {
  return [...new Set(values)];
}

function abs(value: string, base: string) {
  try { return new URL(value, base).toString(); } catch { return ""; }
}

function snippet(html: string, term: string) {
  const i = html.toLowerCase().indexOf(term.toLowerCase());
  return i < 0 ? null : html.slice(Math.max(0, i - 1200), Math.min(html.length, i + 4000));
}

export default {
  async fetch() {
    const response = await fetch(SOURCE_URL, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    const html = await response.text();
    const scripts = uniq([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
      .map(m => abs(m[1], response.url)).filter(Boolean));
    const links = uniq([...html.matchAll(/(?:href|src|action)\s*=\s*["']([^"'#]+)["']/gi)]
      .map(m => abs(m[1], response.url)).filter(Boolean));
    const options = [...html.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/gi)]
      .map(m => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))
      .filter(x => /mar[ií]lia/i.test(x.text) || /mar[ií]lia/i.test(x.attrs));
    const forms = [...html.matchAll(/<form([\s\S]*?)<\/form>/gi)]
      .map(m => m[0]).filter(x => /(encarte|oferta|loja|cidade|mar[ií]lia)/i.test(x)).slice(0, 15);
    const ajax = uniq([
      ...[...html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi)].map(m => m[0].replace(/\\\//g, "/")),
      ...links,
    ]).filter(x => /(ajax|api|encarte|oferta|loja|folheto|pdf|flip|issuu|catalog|muffato|maxatacadista)/i.test(x)).slice(0, 250);

    const terms = ["Marília", "encarte", "ofertas", "lojas", "ajax", "pdf"];
    const snippets: Record<string,string> = {};
    for (const term of terms) {
      const s = snippet(html, term);
      if (s) snippets[term] = s;
    }

    return Response.json({
      status: response.status,
      url: response.url,
      length: html.length,
      scripts,
      options,
      ajax,
      forms,
      snippets,
    }, { headers: { "cache-control": "no-store" } });
  },
};
