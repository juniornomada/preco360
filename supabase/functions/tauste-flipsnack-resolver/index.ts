import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const ACCOUNT_ID="9D99E5AF8D6";
const PROFILE="https://www.flipsnack.com/taustesupermercado/";
function json(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}})}
function norm(v:unknown){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim()}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST") return json(405,{error:"METHOD_NOT_ALLOWED"});
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!service||bearer!==service) return json(401,{error:"UNAUTHORIZED"});
 try{
  const body=await req.json().catch(()=>({}));
  const collectionHash=String(body?.collection_hash||"").trim();
  const sourceUrl=String(body?.source_url||PROFILE).trim();
  if(!/^[a-z0-9_-]{8,}$/i.test(collectionHash)) return json(400,{error:"COLLECTION_HASH_REQUIRED"});
  const raw=btoa(ACCOUNT_ID+"+"+collectionHash);
  const authUrl="https://content-private.flipsnack.com/authorization?hash="+encodeURIComponent(raw)+"&domain=www.flipsnack.com";
  const ar=await fetch(authUrl,{headers:{"user-agent":"Mozilla/5.0","referer":PROFILE,"origin":"https://player.flipsnack.com"}});
  const at=await ar.text();
  if(!ar.ok) return json(502,{error:"AUTH_HTTP_"+ar.status,body:at.slice(0,300)});
  let aj:any; try{aj=JSON.parse(at)}catch{return json(502,{error:"AUTH_INVALID_JSON"})}
  const sig=String(aj?.signature?.[collectionHash]||"");
  if(!sig) return json(502,{error:"AUTH_SIGNATURE_MISSING"});
  const base="https://d3u72tnj701eui.cloudfront.net/"+ACCOUNT_ID+"/collections/"+collectionHash+"/";
  const dr=await fetch(base+"data.json?"+sig,{headers:{"user-agent":"Mozilla/5.0","referer":"https://player.flipsnack.com/"}});
  const dt=await dr.text();
  if(!dr.ok) return json(502,{error:"DATA_HTTP_"+dr.status,body:dt.slice(0,300)});
  let data:any; try{data=JSON.parse(dt)}catch{return json(502,{error:"DATA_INVALID_JSON"})}
  const title=String(data?.properties?.title||"").trim();
  if(!norm(title).includes("marilia")) return json(409,{error:"PUBLICATION_NOT_MARILIA",title});
  const order=(Array.isArray(data?.pages?.order)?data.pages.order:[]).flat().map((x:any)=>String(x||"").trim()).filter(Boolean);
  const pages=order.map((id:string,index:number)=>{
    const p=data?.pages?.data?.[id]||{};
    const sh=String(p?.source?.hash||"").trim();
    const pn=Math.max(1,Number(p?.source?.page||0)+1);
    if(!sh) return null;
    return {id,position:index+1,source_hash:sh,source_page:pn,url:base+"items/"+encodeURIComponent(sh)+"/covers/page_"+pn+"/original?"+sig,type:String(p?.type||"jpg"),width:Number(p?.width)||null,height:Number(p?.height)||null};
  }).filter(Boolean);
  if(!pages.length) return json(502,{error:"PUBLICATION_WITHOUT_PAGES"});
  return json(200,{collection_hash:collectionHash,title:title||"Ofertas Tauste Marília",source_url:sourceUrl,updated_at:Number(data?.properties?.dateLastUpdate)||null,page_count:pages.length,pages});
 }catch(e){return json(502,{error:e instanceof Error?e.message:String(e)})}
});