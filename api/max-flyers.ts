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
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
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
        .filter((s:any)=>norm(s?.nmCidade)==="marilia")
        .map((s:any)=>({
          id:String(s.cdLoja),
          city:String(s.nmCidade??""),
          city_id:String(s.cdCidade??""),
          name:String(s.nmLoja??""),
          raw:s,
        }));

      const results:any[]=[];
      for(const store of stores){
        const url=OFFERS+"?action=getOffers&store="+encodeURIComponent(store.id);
        const data=await getJson(url);
        results.push({
          store:{id:store.id,city:store.city,city_id:store.city_id,name:store.name},
          endpoint:url,
          data,
        });
      }

      return Response.json({
        retailer:"Max Atacadista",
        city:"Marília",
        source_url:"https://www.maxatacadista.com.br/lojas/",
        stores:results,
      },{headers:{"cache-control":"no-store"}});
    }catch(error){
      return Response.json({error:String(error)},{status:502,headers:{"cache-control":"no-store"}});
    }
  }
};
