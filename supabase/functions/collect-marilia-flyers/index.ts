import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

const SOURCES = [
  { retailer:"Atacadão", urls:["https://www.atacadao.com.br/loja/marilia"], city:"Marília" },
  { retailer:"Max Atacadista", urls:["https://www.maxatacadista.com.br/lojas/","https://www.maxatacadista.com.br/"], city:"Marília" },
  { retailer:"Kawakami", urls:["https://institucional.kawakami.com.br/oferta/marilia","https://institucional.kawakami.com.br/ofertas/marilia","https://institucional.kawakami.com.br/ofertas"], city:"Marília" },
  { retailer:"Confiança", urls:["https://www.clienteconfianca.com.br/tabloide-confianca/marilia","https://www.clienteconfianca.com.br/tabloide/marilia","https://www.clienteconfianca.com.br/ofertas"], city:"Marília" },
  { retailer:"Tauste", urls:["https://institucional.tauste.com.br/ofertas","https://www.flipsnack.com/taustesupermercado/"], city:"Marília" },
] as const;
const USER_ID="e596fdb9-5827-438a-a01a-f452822ad757";
const UA="Mozilla/5.0 (compatible; Preco360FlyerBot/1.0; +https://preco360.vercel.app)";

function sb(){return createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}})}
function clean(u:string){try{const x=new URL(u);x.hash="";["utm_source","utm_medium","utm_campaign","fbclid","gclid"].forEach(k=>x.searchParams.delete(k));return x.toString()}catch{return u}}
function abs(h:string,b:string){try{return new URL(h,b).toString()}catch{return ""}}
function textOnly(s:string){return s.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim()}
function dateBR(s:string){const m=s.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);if(!m)return null;let y=m[3]?Number(m[3]):new Date().getFullYear();if(y<100)y+=2000;return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`}
function validity(t:string){const r=[...t.matchAll(/(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?)/g)].map(x=>dateBR(x[1])).filter(Boolean) as string[];return {from:r[0]||null,to:r[1]||r[0]||null}}
async function sha(bytes:Uint8Array){const d=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function pdfPageCount(bytes:Uint8Array){
  try{
    const text=new TextDecoder("latin1").decode(bytes);
    const pages=(text.match(/\/Type\s*\/Page(?!s)\b/g)||[]).length;
    const counts=[...text.matchAll(/\/Count\s+(\d+)/g)].map(m=>Number(m[1])).filter(n=>Number.isFinite(n)&&n>0&&n<500);
    return Math.max(1,pages,...counts);
  }catch{return 1}
}
async function writeRegistry(db:any, known:any, values:any){
  if(known?.id){
    const {error}=await db.from("flyer_source_registry").update(values).eq("id",known.id);
    if(error) throw error;
    return known.id;
  }
  const {data,error}=await db.from("flyer_source_registry").insert(values).select("id").single();
  if(error) throw error;
  return data.id;
}
async function collectAtacadao(db:any, report:any[], onlyTitle=""){
  const endpoint="https://preco360.vercel.app/api/atacadao-flyers";
  const sourcePage="https://www.atacadao.com.br/loja/marilia";
  let payload:any;
  try{
    const r=await fetch(endpoint,{headers:{"accept":"application/json","user-agent":UA}});
    if(!r.ok) throw new Error("Vercel bridge HTTP "+r.status);
    payload=await r.json();
  }catch(e){
    report.push({retailer:"Atacadão",endpoint:sourcePage,result:"erro",error:String(e)});
    return;
  }
  let flyers=Array.isArray(payload?.flyers)?payload.flyers:[];
  if(onlyTitle) flyers=flyers.filter((f:any)=>String(f?.title||"").toLowerCase()===onlyTitle.toLowerCase());
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  flyers=flyers.filter((f:any)=>f?.id&&f?.url&&f?.valid_to&&String(f.valid_to)>=today);
  let imported=0,unchanged=0,failed=0;
  for(const flyer of flyers){
    const sourceKey="atacadao:630:"+String(flyer.id);
    const now=new Date().toISOString();
    const {data:known}=await db.from("flyer_source_registry").select("*")
      .eq("user_id",USER_ID).eq("retailer","Atacadão").eq("city","Marília").eq("source_key",sourceKey).maybeSingle();

    if(known?.status==="processed" && known?.valid_from===flyer.valid_from && known?.valid_to===flyer.valid_to && known?.file_hash){
      await db.from("flyer_source_registry").update({last_seen_at:now,status:"unchanged"}).eq("id",known.id);
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,validity:{from:flyer.valid_from,to:flyer.valid_to},result:"já conhecido antes do download",files:0,offers:0});
      unchanged++;
      continue;
    }

    let head:any={etag:null,last_modified:null,content_length:null};
    try{
      const hr=await fetchSafe(flyer.url,"HEAD");
      head={etag:hr.headers.get("etag"),last_modified:hr.headers.get("last-modified"),content_length:Number(hr.headers.get("content-length"))||null};
    }catch{}

    let response:Response;
    try{response=await fetchSafe(flyer.url)}catch(e){
      failed++;
      await writeRegistry(db,known,{user_id:USER_ID,retailer:"Atacadão",city:"Marília",source_key:sourceKey,source_url:flyer.url,source_title:flyer.title,valid_from:flyer.valid_from,valid_to:flyer.valid_to,...head,last_seen_at:now,status:"failed",last_error:String(e)});
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,validity:{from:flyer.valid_from,to:flyer.valid_to},result:"erro",error:String(e)});
      continue;
    }
    if(!response.ok){
      failed++;
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,validity:{from:flyer.valid_from,to:flyer.valid_to},result:"erro",error:"PDF HTTP "+response.status});
      continue;
    }
    const ct=response.headers.get("content-type")||"application/pdf";
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(!bytes.length){
      failed++;
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,result:"erro",error:"PDF vazio"});
      continue;
    }
    const hash=await sha(bytes);
    const [{data:saved},{data:jobs}]=await Promise.all([
      db.from("flyers").select("id").eq("user_id",USER_ID).eq("file_hash",hash).limit(1),
      db.from("flyer_import_jobs").select("id,status,result").eq("user_id",USER_ID).eq("file_hash",hash).in("status",["queued","processing","refining","completed"]).order("created_at",{ascending:false}).limit(1),
    ]);
    if(saved?.length){
      const flyerId=saved[0].id;
      await db.from("flyers").update({
        retailer:"Atacadão",
        title:"Atacadão · "+flyer.title,
        valid_from:flyer.valid_from,
        valid_to:flyer.valid_to,
        city:"Marília",
      }).eq("id",flyerId);
      const {count:offerCount}=await db.from("flyer_items").select("id",{count:"exact",head:true}).eq("flyer_id",flyerId);
      await writeRegistry(db,known,{user_id:USER_ID,retailer:"Atacadão",city:"Marília",source_key:sourceKey,source_url:flyer.url,source_title:flyer.title,valid_from:flyer.valid_from,valid_to:flyer.valid_to,...head,file_hash:hash,last_seen_at:now,last_downloaded_at:now,last_processed_at:known?.last_processed_at||now,status:"processed",last_error:null});
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,validity:{from:flyer.valid_from,to:flyer.valid_to},result:"duplicado pelo hash após download",files:1,offers:offerCount||0});
      unchanged++;
      continue;
    }
    if(jobs?.length){
      const existingJob=jobs[0];
      if(existingJob.status==="completed"){
        try{
          const fr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/finalize-flyer-job`,{method:"POST",headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},body:JSON.stringify({job_id:existingJob.id})});
          if(fr.ok){
            const fin=await fr.json().catch(()=>({}));
            await writeRegistry(db,known,{user_id:USER_ID,retailer:"Atacadão",city:"Marília",source_key:sourceKey,source_url:flyer.url,source_title:flyer.title,valid_from:flyer.valid_from,valid_to:flyer.valid_to,...head,file_hash:hash,last_seen_at:now,last_downloaded_at:now,last_processed_at:now,status:"processed",last_error:null});
            report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,validity:{from:flyer.valid_from,to:flyer.valid_to},result:"processado recuperado",files:1,offers:fin?.offers_saved||0,job_id:existingJob.id});
            imported++;
            continue;
          }
        }catch{}
      }
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,validity:{from:flyer.valid_from,to:flyer.valid_to},result:"já em processamento",files:0,offers:0,job_id:existingJob.id,status:existingJob.status});
      unchanged++;
      continue;
    }

    const pages=pdfPageCount(bytes);
    const path=`auto/marilia/atacadao/${hash}.pdf`;
    const {error:upErr}=await db.storage.from("flyers").upload(path,bytes,{contentType:"application/pdf",upsert:false});
    if(upErr && !/already exists|resource already exists|duplicate/i.test(upErr.message)){
      failed++;
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,result:"erro",error:upErr.message});
      continue;
    }

    const initialResult={auto_import:true,source_title:flyer.title,source_url:flyer.url,source_key:sourceKey,city:"Marília"};
    const {data:job,error:jobErr}=await db.from("flyer_import_jobs").insert({
      user_id:USER_ID,source_file_path:path,source_file_name:`Atacadão - ${flyer.title}.pdf`,mime_type:"application/pdf",file_hash:hash,page_count:pages,status:"queued",
      progress_current:0,progress_total:pages,progress_label:"Arquivo recebido. Aguardando processamento…",
      retailer:"Atacadão",valid_from:flyer.valid_from,valid_to:flyer.valid_to,result:initialResult,
    }).select("id").single();
    if(jobErr){
      failed++;
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,result:"erro",error:jobErr.message});
      continue;
    }
    await writeRegistry(db,known,{user_id:USER_ID,retailer:"Atacadão",city:"Marília",source_key:sourceKey,source_url:flyer.url,source_title:flyer.title,valid_from:flyer.valid_from,valid_to:flyer.valid_to,metadata_fingerprint:[flyer.id,flyer.valid_from,flyer.valid_to].join("|"),...head,file_hash:hash,last_seen_at:now,last_downloaded_at:now,status:"downloaded",last_error:null});
    const pr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-flyer-job`,{method:"POST",headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},body:JSON.stringify({job_id:job.id,mode:"start"})});
    if(!pr.ok){
      failed++;
      report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,validity:{from:flyer.valid_from,to:flyer.valid_to},result:"erro ao iniciar processamento",files:1,offers:0,job_id:job.id,error:"worker HTTP "+pr.status});
      continue;
    }
    imported++;
    report.push({retailer:"Atacadão",endpoint:sourcePage,title:flyer.title,validity:{from:flyer.valid_from,to:flyer.valid_to},result:"novo enviado para processamento",files:1,pages,offers:0,job_id:job.id});
  }
  report.push({retailer:"Atacadão",endpoint:sourcePage,result:"resumo",found:flyers.length,imported,unchanged,failed});
}

async function fetchSafe(url:string,method="GET"){const r=await fetch(url,{method,redirect:"follow",headers:{"user-agent":UA,"accept":"text/html,application/pdf,image/*,*/*"}});return r}
function candidates(html:string,base:string,retailer:string){const out=new Map<string,string>();const re=/(?:href|src)\s*=\s*["']([^"'#]+)["']/gi;for(const m of html.matchAll(re)){const u=abs(m[1],base);if(!u)continue;const l=u.toLowerCase();const isPdf=/\.pdf(?:$|\?)/.test(l);const isImage=/\.(?:jpe?g|png|webp)(?:$|\?)/.test(l);const flyerHint=/(folheto|encarte|tabloid|oferta|catalog|flipbook|publication)/.test(l);const isPublication=/flipsnack\.com\/(?!taustesupermercado\/?$)[^?#]+/.test(l);if(isPdf||(isImage&&flyerHint)||isPublication)out.set(clean(u),u)}if(retailer==="Tauste"){for(const m of html.matchAll(/https?:\\?\/\\?\/[^\"'<> ]*flipsnack[^\"'<> ]+/gi)){const u=m[0].replaceAll("\\/","/");out.set(clean(u),u)}}return [...out.values()]}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return new Response("POST only",{status:405,headers:corsHeaders});
 const key=req.headers.get("x-cron-key"), expected=Deno.env.get("FLYER_CRON_SECRET");
 if(expected && key!==expected)return new Response("unauthorized",{status:401,headers:corsHeaders});
 const db=sb(), report:any[]=[];
 let body:any={}; try{body=await req.json()}catch{}
 const requestedRetailer=String(body?.retailer||"").trim();
 const requestedTitle=String(body?.title||"").trim();
 for(const src of SOURCES){
  if(requestedRetailer && src.retailer!==requestedRetailer) continue;
  if(src.retailer==="Atacadão"){
    await collectAtacadao(db,report,requestedTitle);
    continue;
  }
  let page:any=null, used="", err="";
  for(const u of src.urls){try{const r=await fetchSafe(u);if(r.ok){const h=await r.text();if(/mar[ií]lia/i.test(h)||src.retailer==="Tauste"){page={html:h,headers:r.headers};used=r.url;break}}err=`HTTP ${r.status}`}catch(e){err=String(e)}}
  if(!page){report.push({retailer:src.retailer,result:"erro",error:err||"página oficial indisponível"});continue}
  const plain=textOnly(page.html), val=validity(plain), links=candidates(page.html,used,src.retailer);
  let handled=0, imported=0, unchanged=0, failed=0;
  for(const asset of links){
   const sourceKey=clean(asset).replace(/([?&](token|sig|signature|expires)=[^&]*)/gi,"");
   const meta={etag:null as string|null,last_modified:null as string|null,content_length:null as number|null};
   try{const hr=await fetchSafe(asset,"HEAD");meta.etag=hr.headers.get("etag");meta.last_modified=hr.headers.get("last-modified");meta.content_length=Number(hr.headers.get("content-length"))||null}catch{}
   const {data:known}=await db.from("flyer_source_registry").select("*").eq("user_id",USER_ID).eq("retailer",src.retailer).eq("city","Marília").eq("source_key",sourceKey).maybeSingle();
   if(known && (known.etag&&known.etag===meta.etag || known.last_modified&&known.last_modified===meta.last_modified) && (!val.to||known.valid_to===val.to)){
    await db.from("flyer_source_registry").update({last_seen_at:new Date().toISOString(),status:"unchanged"}).eq("id",known.id);
    report.push({retailer:src.retailer,endpoint:used,title:plain.slice(0,120),validity:val,result:"já conhecido antes do download",files:0,offers:0});handled++;unchanged++;continue;
   }
   let ar;try{ar=await fetchSafe(asset)}catch{continue} if(!ar.ok)continue;
   const ct=ar.headers.get("content-type")||"";if(!/(pdf|image)/i.test(ct) && !/\.(pdf|png|jpe?g|webp)(\?|$)/i.test(asset))continue;
   const bytes=new Uint8Array(await ar.arrayBuffer());if(!bytes.length)continue;const hash=await sha(bytes);
   const [{data:f},{data:j}]=await Promise.all([db.from("flyers").select("id").eq("user_id",USER_ID).eq("file_hash",hash).limit(1),db.from("flyer_import_jobs").select("id,status").eq("user_id",USER_ID).eq("file_hash",hash).in("status",["queued","processing","completed"]).limit(1)]);
   if(f?.length||j?.length){await db.from("flyer_source_registry").upsert({user_id:USER_ID,retailer:src.retailer,city:"Marília",source_key:sourceKey,source_url:clean(asset),source_title:plain.slice(0,200),valid_from:val.from,valid_to:val.to,...meta,file_hash:hash,last_seen_at:new Date().toISOString(),last_downloaded_at:new Date().toISOString(),status:"unchanged"},{onConflict:"user_id,lower(retailer),lower(city),source_key"});report.push({retailer:src.retailer,endpoint:used,validity:val,result:"duplicado pelo hash após download",files:1,offers:0});handled++;unchanged++;continue}
   const ext=/pdf/i.test(ct)||/\.pdf/i.test(asset)?"pdf":/png/i.test(ct)||/\.png/i.test(asset)?"png":"jpg";const path=`auto/marilia/${src.retailer.toLowerCase().replace(/\W+/g,"-")}/${hash}.${ext}`;
   const {error:upErr}=await db.storage.from("flyers").upload(path,bytes,{contentType:ct||undefined,upsert:false});if(upErr && !/already exists|resource already exists|duplicate/i.test(upErr.message)){err=upErr.message;failed++;continue}
   const {data:job,error:jobErr}=await db.from("flyer_import_jobs").insert({user_id:USER_ID,source_file_path:path,source_file_name:path.split("/").pop(),mime_type:ct||null,file_hash:hash,status:"queued",retailer:src.retailer,valid_from:val.from,valid_to:val.to}).select("id").single();if(jobErr){err=jobErr.message;continue}
   await db.from("flyer_source_registry").upsert({user_id:USER_ID,retailer:src.retailer,city:"Marília",source_key:sourceKey,source_url:clean(asset),source_title:plain.slice(0,200),valid_from:val.from,valid_to:val.to,...meta,file_hash:hash,last_seen_at:new Date().toISOString(),last_downloaded_at:new Date().toISOString(),status:"downloaded"},{onConflict:"user_id,lower(retailer),lower(city),source_key"});
   const r=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-flyer-job`,{method:"POST",headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},body:JSON.stringify({job_id:job.id})});
   const {data:state}=await db.from("flyer_import_jobs").select("status,error_message").eq("id",job.id).maybeSingle();
   let offers=0;
   if(state?.status==="completed"){const {data:fly}=await db.from("flyers").select("id").eq("user_id",USER_ID).eq("file_hash",hash).maybeSingle();if(fly?.id){const {count}=await db.from("flyer_items").select("id",{count:"exact",head:true}).eq("flyer_id",fly.id);offers=count||0}await db.from("flyer_source_registry").update({status:"processed",last_processed_at:new Date().toISOString(),last_error:null}).eq("user_id",USER_ID).eq("retailer",src.retailer).eq("city","Marília").eq("source_key",sourceKey)}
   const ok=r.ok&&state?.status==="completed";
   report.push({retailer:src.retailer,endpoint:used,validity:val,result:ok?"novo importado":"erro no processamento",files:1,offers,job_id:job.id,error:ok?null:(state?.error_message||"processamento não concluído")});handled++;if(ok)imported++;else failed++;continue;
  }
  if(!handled) report.push({retailer:src.retailer,endpoint:used,validity:val,result:links.length?"erro":"sem asset oficial obtível com segurança",files:0,offers:0,error:err||null});
  else report.push({retailer:src.retailer,endpoint:used,result:"resumo",found:links.length,imported,unchanged,failed});
 }
 return new Response(JSON.stringify({city:"Marília",ran_at:new Date().toISOString(),report}),{headers:{...corsHeaders,"content-type":"application/json"}});
});