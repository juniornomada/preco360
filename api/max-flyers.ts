const ROOT = "https://www.maxatacadista.com.br";
const URLS = [
  ROOT + "/assets/scripts/stores.js",
  ROOT + "/assets/scripts/muffato-max-common.js",
  ROOT + "/assets/scripts/muffato-max-bootstrap.js",
];

function snippets(text:string, term:string){
  const out:string[]=[]; const low=text.toLowerCase(); let p=0;
  while((p=low.indexOf(term.toLowerCase(),p))>=0 && out.length<8){
    out.push(text.slice(Math.max(0,p-1200),Math.min(text.length,p+2800)));
    p+=term.length;
  }
  return out;
}

export default {
  async fetch(){
    const headers={"user-agent":"Mozilla/5.0","accept":"application/javascript,text/plain,*/*"};
    const results:any[]=[];
    for(const url of URLS){
      const r=await fetch(url,{headers});
      const text=await r.text();
      const hits:Record<string,string[]>={};
      for(const term of ["getStores","getStore","has-stores","data-city","cdLoja","NossasLojas","sm-rds","getOffers"]){
        const s=snippets(text,term); if(s.length) hits[term]=s;
      }
      results.push({url,status:r.status,length:text.length,hits});
    }
    return Response.json({results},{headers:{"cache-control":"no-store"}});
  }
};
