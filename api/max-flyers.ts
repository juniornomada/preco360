const SOURCE_URL = "https://www.maxatacadista.com.br/lojas/";
const SCRIPT_URL = "https://www.maxatacadista.com.br/assets/scripts/stores.js";

function uniq<T>(values: T[]) { return [...new Set(values)]; }
function snippet(text: string, term: string) {
  const low=text.toLowerCase(); let pos=0; const out:string[]=[];
  while((pos=low.indexOf(term.toLowerCase(),pos))>=0 && out.length<12) {
    out.push(text.slice(Math.max(0,pos-900),Math.min(text.length,pos+2200)));
    pos+=term.length;
  }
  return out;
}

export default {
  async fetch() {
    const headers={
      "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      accept:"text/html,application/javascript,*/*",
      "accept-language":"pt-BR,pt;q=0.9,en;q=0.8",
    };
    const [pageResponse,scriptResponse]=await Promise.all([
      fetch(SOURCE_URL,{redirect:"follow",headers}),
      fetch(SCRIPT_URL,{redirect:"follow",headers}),
    ]);
    const html=await pageResponse.text();
    const script=await scriptResponse.text();
    const paths=uniq([
      ...[...script.matchAll(/["'](\/[^"'\n\r]+)["']/g)].map(m=>m[1]),
      ...[...script.matchAll(/https?:\/\/[^"'\s)]+/g)].map(m=>m[0]),
    ]).filter(x=>/(loja|store|encarte|video|oferta|ajax|api)/i.test(x));
    const variables=uniq([...script.matchAll(/\b(?:url|endpoint|route|path)\w*\s*[:=]\s*["']([^"']+)["']/gi)].map(m=>m[1]));
    const terms=["ajax","stores","loja","encarte","videos","getJSON","$.get","$.post"];
    const snippets:Record<string,string[]>={};
    for(const term of terms){const rows=snippet(script,term);if(rows.length)snippets[term]=rows;}
    return Response.json({
      page_status:pageResponse.status,
      script_status:scriptResponse.status,
      page_length:html.length,
      script_length:script.length,
      paths,variables,snippets,
    },{headers:{"cache-control":"no-store"}});
  },
};
