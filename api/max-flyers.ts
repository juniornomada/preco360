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

async function getJson(url:string, attempts=3){
  let lastError:unknown=null;

  for(let attempt=1;attempt<=attempts;attempt++){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),9000);
    try{
      const r=await fetch(url,{
        redirect:"follow",
        signal:controller.signal,
        headers:{
          "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
          accept:"application/json,text/javascript,*/*",
          "accept-language":"pt-BR,pt;q=0.9",
          "cache-control":"no-cache",
        },
      });
      const text=await r.text();
      if(!r.ok) throw new Error("HTTP "+r.status+" "+url);
      try{
        return JSON.parse(stripJsonp(text));
      }catch{
        const preview=text
          .replace(/<script\b[\s\S]*?<\/script>/gi," ")
          .replace(/<style\b[\s\S]*?<\/style>/gi," ")
          .replace(/<[^>]+>/g," ")
          .replace(/\s+/g," ")
          .trim()
          .slice(0,280);
        throw new Error(
          "Resposta inválida do serviço Max" +
          (preview ? ": " + preview : ""),
        );
      }
    }catch(error){
      lastError=error;
      if(attempt<attempts) await new Promise(resolve=>setTimeout(resolve,250*attempt));
    }finally{
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function flyerRows(data:any, store:any){
  const rows:any[]=[];
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
      .filter((page:any)=>page.url)
      .sort((a:any,b:any)=>a.position-b.position);

    if(!pages.length) continue;
    const id=String(pages[0].id||"").trim();
    if(!id || !isFlyerCampaign(pages[0].filename)) continue;

    rows.push({
      id,
      title:campaignTitle(pages[0].filename,id),
      store,
      pages,
    });
  }
  return rows;
}

export default {
  async fetch(){
    const checkedAt=new Date().toISOString();

    let allStores:any;
    try{
      allStores=await getJson(STORE_LIST,3);
    }catch(error){
      return Response.json({
        retailer:"Max Atacadista",
        city:"Marília",
        source_url:"https://www.maxatacadista.com.br/lojas/",
        checked_at:checkedAt,
        capture_ready:false,
        stores:[],
        flyers:[],
        error:"MAX_STORE_LIST_UNAVAILABLE",
        detail:error instanceof Error ? error.message : String(error),
      },{status:502,headers:{"cache-control":"no-store"}});
    }

    const stores=(Array.isArray(allStores)?allStores:[])
      .filter((s:any)=>
        norm(s?.nmCidade)==="marilia" &&
        /^max atacadista\b/i.test(String(s?.nmLoja??"").trim())
      )
      .map((s:any)=>({
        id:String(s.cdLoja??"").trim(),
        city:String(s.nmCidade??""),
        city_id:String(s.cdCidade??""),
        name:String(s.nmLoja??"").trim(),
      }))
      .filter((s:any)=>s.id);

    if(!stores.length){
      return Response.json({
        retailer:"Max Atacadista",
        city:"Marília",
        source_url:"https://www.maxatacadista.com.br/lojas/",
        checked_at:checkedAt,
        capture_ready:false,
        stores:[],
        flyers:[],
        error:"MAX_MARILIA_STORES_NOT_FOUND",
      },{headers:{"cache-control":"no-store"}});
    }

    const results=await Promise.all(
      stores.map(async(store:any)=>{
        const endpoint=OFFERS+"?action=getOffers&store="+encodeURIComponent(store.id);
        try{
          const data=await getJson(endpoint,3);
          return {ok:true,store,rows:flyerRows(data,store),error:null};
        }catch(error){
          return {
            ok:false,
            store,
            rows:[],
            error:error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    const grouped=new Map<string,any>();
    const successfulStores:any[]=[];
    const storeErrors:any[]=[];

    for(const result of results){
      if(!result.ok){
        storeErrors.push({
          store_id:result.store.id,
          store_name:result.store.name,
          error:result.error,
        });
        continue;
      }

      successfulStores.push(result.store);
      for(const row of result.rows){
        const current=grouped.get(row.id)??{
          id:row.id,
          title:row.title,
          stores:[],
          pages:row.pages,
          official_listing:true,
        };
        if(!current.stores.some((s:any)=>s.id===row.store.id)){
          current.stores.push(row.store);
        }
        if(row.pages.length>current.pages.length) current.pages=row.pages;
        grouped.set(row.id,current);
      }
    }

    const flyers=[...grouped.values()].sort((a,b)=>Number(b.id)-Number(a.id));
    const captureReady=successfulStores.length>0;

    return Response.json({
      retailer:"Max Atacadista",
      city:"Marília",
      source_url:"https://www.maxatacadista.com.br/lojas/",
      checked_at:checkedAt,
      capture_ready:captureReady,
      stores,
      successful_stores:successfulStores,
      store_errors:storeErrors,
      flyers,
    },{
      status:200,
      headers:{"cache-control":"no-store"},
    });
  }
};
