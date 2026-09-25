const STORE_LIST =
  "https://institucional.supermuffato.com.br/webtools/services/api/muffatomax/seja-representante/seja-representante-controle.php?action=getStores&callback=getStores";
const OFFERS =
  "https://institucional.supermuffato.com.br/webtools/services/api/sm-rds-ofertas.php";

function stripJsonp(text:string){
  const value=text.trim();
  const first=value.indexOf("(");
  const last=value.lastIndexOf(")");
  if(first>0 && last>first) return value.slice(first+1,last);
  return value;
}

function norm(value:unknown){
  return String(value??"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .trim();
}

function absoluteAsset(value:unknown){
  const url=String(value??"").trim();
  if(!url) return "";
  if(url.startsWith("//")) return "https:"+url;
  if(/^https?:\/\//i.test(url)) return url;
  return new URL(url,"https://institucional.supermuffato.com.br").toString();
}

function campaignTitle(filename:string,id:string){
  const value=decodeURIComponent(filename)
    .replace(/\.(?:jpe?g|png|webp)$/i,"")
    .replace(/\s*[-–—]?\s*(?:p[aá]g\.?|pag\.?|pagina)\s*\d+.*$/i,"")
    .replace(/[_]+/g," ")
    .replace(/\s+/g," ")
    .trim();

  const low=norm(value);
  if(low.includes("aniversario")) return "Aniversário";
  if(low.includes("primavera")) return "Primavera";
  if(low.includes("unilever")) return "Unilever";
  return value || ("Encarte "+id);
}

function isFlyerCampaign(filename:string){
  const low=norm(filename);
  if(/delivery|transformadores|max_22_02_post_televendas|televendas/.test(low)) return false;
  return true;
}

async function getJson(url:string){
  const r=await fetch(url,{headers:{
    "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    accept:"application/json,text/javascript,*/*",
    "accept-language":"pt-BR,pt;q=0.9",
  }});
  const text=await r.text();
  if(!r.ok) throw new Error("HTTP "+r.status+" "+url);
  return JSON.parse(stripJsonp(text));
}

export default {
  async fetch(){
    try{
      const allStores=await getJson(STORE_LIST);
      const stores=(Array.isArray(allStores)?allStores:[])
        .filter((s:any)=>norm(s?.nmCidade)==="marilia" && /max atacadista/i.test(String(s?.nmLoja??"")))
        .map((s:any)=>({
          id:String(s.cdLoja),
          city:String(s.nmCidade??""),
          city_id:String(s.cdCidade??""),
          name:String(s.nmLoja??""),
        }));

      const grouped=new Map<string,any>();
      for(const store of stores){
        const endpoint=OFFERS+"?action=getOffers&store="+encodeURIComponent(store.id);
        const data=await getJson(endpoint);
        for(const offer of (Array.isArray(data?.offers)?data.offers:[])){
          const pages=(offer?.flyer?.[0]?.item??[])
            .filter((item:any)=>String(item?.type)==="1" && item?.image)
            .map((item:any)=>({
              id:String(item.id??""),
              url:absoluteAsset(item.image),
              filename:String(item.image??"").split("/").pop()??"",
              is_cover:Boolean(item.isCover),
              position:Number(item.position)||0,
              width:Number(item.width)||null,
              height:Number(item.height)||null,
            }))
            .sort((a:any,b:any)=>a.position-b.position);
          if(!pages.length) continue;
          const id=String(pages[0].id||"").trim();
          if(!id || !isFlyerCampaign(pages[0].filename)) continue;

          const key=id;
          const current=grouped.get(key)??{
            id,
            title:campaignTitle(pages[0].filename,id),
            stores:[],
            pages,
            official_listing:true,
          };
          if(!current.stores.some((s:any)=>s.id===store.id)) current.stores.push(store);
          if(pages.length>current.pages.length) current.pages=pages;
          grouped.set(key,current);
        }
      }

      const flyers=[...grouped.values()].sort((a,b)=>Number(b.id)-Number(a.id));
      return Response.json({
        retailer:"Max Atacadista",
        city:"Marília",
        source_url:"https://www.maxatacadista.com.br/lojas/",
        checked_at:new Date().toISOString(),
        stores,
        flyers,
      },{headers:{"cache-control":"no-store"}});
    }catch(error){
      return Response.json({error:String(error)},{status:502,headers:{"cache-control":"no-store"}});
    }
  }
};
