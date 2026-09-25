import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

const SOURCES = [
  { retailer:"Atacadão", urls:["https://www.atacadao.com.br/loja/marilia"], city:"Marília" },
  { retailer:"Max Atacadista", urls:["https://www.maxatacadista.com.br/lojas/","https://www.maxatacadista.com.br/"], city:"Marília" },
  { retailer:"Kawakami", urls:["https://institucional.kawakami.com.br/oferta/marilia","https://institucional.kawakami.com.br/ofertas/marilia","https://institucional.kawakami.com.br/ofertas"], city:"Marília" },
  { retailer:"Confiança", urls:["https://clienteconfianca.com.br/ofertas-marilia.html","https://www.clienteconfianca.com.br/ofertas.html"], city:"Marília" },
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

    if((known?.status==="processed" || known?.status==="unchanged") && known?.valid_from===flyer.valid_from && known?.valid_to===flyer.valid_to && known?.file_hash){
      await db.from("flyer_source_registry").update({last_seen_at:now,status:"processed"}).eq("id",known.id);
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

    const initialResult={auto_import:true,source_title:flyer.title,source_url:flyer.url,source_key:sourceKey,city:"Marília",valid_from:flyer.valid_from,valid_to:flyer.valid_to,validity_locked:true};
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

async function collectMaxAtacadista(db:any, report:any[], onlyTitle=""){
  const bridge="https://preco360.vercel.app/api/max-flyers";
  const sourcePage="https://www.maxatacadista.com.br/lojas/";
  let payload:any;
  try{
    const r=await fetch(bridge,{headers:{"accept":"application/json","user-agent":UA}});
    if(!r.ok) throw new Error("Vercel bridge HTTP "+r.status);
    payload=await r.json();
  }catch(e){
    report.push({retailer:"Max Atacadista",endpoint:sourcePage,result:"erro",error:String(e)});
    return;
  }

  let flyers=Array.isArray(payload?.flyers)?payload.flyers:[];
  if(onlyTitle) flyers=flyers.filter((f:any)=>String(f?.title||"").toLowerCase()===onlyTitle.toLowerCase());
  let imported=0,unchanged=0,failed=0;

  for(const flyer of flyers){
    const id=String(flyer?.id||"").trim();
    const pages=Array.isArray(flyer?.pages)?flyer.pages.filter((p:any)=>p?.url):[];
    if(!id||!pages.length) continue;

    const sourceKey="max:"+id;
    const now=new Date().toISOString();
    const title=String(flyer?.title||("Encarte "+id)).trim();
    const unitNames=(Array.isArray(flyer?.stores)?flyer.stores:[]).map((s:any)=>String(s?.name||"").trim()).filter(Boolean);
    const {data:known}=await db.from("flyer_source_registry").select("*")
      .eq("user_id",USER_ID).eq("retailer","Max Atacadista").eq("city","Marília").eq("source_key",sourceKey).maybeSingle();

    if(known && (known.status==="processed"||known.status==="expired")){
      await db.from("flyer_source_registry").update({last_seen_at:now,status:known.status}).eq("id",known.id);
      report.push({
        retailer:"Max Atacadista",endpoint:sourcePage,title,
        validity:{from:known.valid_from||sourceValidity.from||null,to:known.valid_to||sourceValidity.to||null},
        result:known.status==="expired"?"expirado já conhecido":"já conhecido antes do download",
        files:0,offers:0,units:unitNames,
      });
      unchanged++;
      continue;
    }

    const downloaded:any[]=[];
    let pageFailed=false;
    for(let i=0;i<pages.length;i++){
      const page=pages[i];
      try{
        const r=await fetchSafe(String(page.url));
        if(!r.ok) throw new Error("HTTP "+r.status);
        const ct=r.headers.get("content-type")||"image/jpeg";
        const bytes=new Uint8Array(await r.arrayBuffer());
        if(!bytes.length) throw new Error("imagem vazia");
        downloaded.push({index:i+1,url:String(page.url),bytes,ct,hash:await sha(bytes),filename:String(page.filename||("page-"+(i+1)+".jpeg"))});
      }catch(e){
        pageFailed=true;
        failed++;
        report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"erro",error:"Página "+(i+1)+": "+String(e),files:0,offers:0});
        break;
      }
    }
    if(pageFailed||!downloaded.length) continue;

    const manifest=downloaded.map(p=>p.hash).join("|");
    const combinedHash=await sha(new TextEncoder().encode(manifest));
    const [{data:saved},{data:jobs}]=await Promise.all([
      db.from("flyers").select("id").eq("user_id",USER_ID).eq("file_hash",combinedHash).limit(1),
      db.from("flyer_import_jobs").select("id,status,result").eq("user_id",USER_ID).eq("file_hash",combinedHash).in("status",["queued","processing","refining","completed"]).order("created_at",{ascending:false}).limit(1),
    ]);

    if(saved?.length){
      const flyerId=saved[0].id;
      const {count:offerCount}=await db.from("flyer_items").select("id",{count:"exact",head:true}).eq("flyer_id",flyerId);
      await writeRegistry(db,known,{
        user_id:USER_ID,retailer:"Max Atacadista",city:"Marília",source_key:sourceKey,
        source_url:pages[0].url,source_title:title,file_hash:combinedHash,last_seen_at:now,last_downloaded_at:now,
        last_processed_at:known?.last_processed_at||now,status:"processed",last_error:null,
        metadata_fingerprint:[id,pages.length,...unitNames].join("|"),
      });
      report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"duplicado pelo hash após download",files:downloaded.length,offers:offerCount||0,units:unitNames});
      unchanged++;
      continue;
    }

    if(jobs?.length){
      const existingJob=jobs[0];
      if(existingJob.status==="completed"){
        try{
          const fr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/finalize-flyer-job`,{
            method:"POST",
            headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},
            body:JSON.stringify({job_id:existingJob.id}),
          });
          if(fr.ok){
            const fin=await fr.json().catch(()=>({}));
            await writeRegistry(db,known,{
              user_id:USER_ID,retailer:"Max Atacadista",city:"Marília",source_key:sourceKey,
              source_url:pages[0].url,source_title:title,file_hash:combinedHash,last_seen_at:now,last_downloaded_at:now,
              last_processed_at:now,status:"processed",last_error:null,
              valid_from:fin?.valid_from||known?.valid_from||null,valid_to:fin?.valid_to||known?.valid_to||null,
              metadata_fingerprint:[id,pages.length,...unitNames].join("|"),
            });
            report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"processado recuperado",files:downloaded.length,offers:fin?.offers_saved||0,job_id:existingJob.id,units:unitNames});
            imported++;
            continue;
          }else{
            const body=await fr.json().catch(()=>({}));
            if(body?.error==="FLYER_EXPIRED"){
              await writeRegistry(db,known,{
                user_id:USER_ID,retailer:"Max Atacadista",city:"Marília",source_key:sourceKey,
                source_url:pages[0].url,source_title:title,file_hash:combinedHash,last_seen_at:now,last_downloaded_at:now,
                status:"expired",valid_to:body?.valid_to||null,last_error:null,
                metadata_fingerprint:[id,pages.length,...unitNames].join("|"),
              });
              report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"expirado",files:downloaded.length,offers:0,job_id:existingJob.id,units:unitNames});
              unchanged++;
              continue;
            }
          }
        }catch{}
      }
      report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"já em processamento",files:0,offers:0,job_id:existingJob.id,status:existingJob.status,units:unitNames});
      unchanged++;
      continue;
    }

    const jobId=crypto.randomUUID();
    const sourceFiles:any[]=[];
    let uploadFailed=false;
    for(const page of downloaded){
      const safeName=page.filename.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").slice(-120)||("page-"+page.index+".jpeg");
      const path=`${USER_ID}/imports/${jobId}/page-${String(page.index).padStart(3,"0")}-${safeName}`;
      const {error}=await db.storage.from("flyers").upload(path,page.bytes,{contentType:page.ct||"image/jpeg",upsert:false});
      if(error){
        uploadFailed=true;
        failed++;
        report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"erro",error:"Upload página "+page.index+": "+error.message,files:0,offers:0});
        break;
      }
      sourceFiles.push({path,name:page.filename,mime_type:page.ct||"image/jpeg",size:page.bytes.length});
    }
    if(uploadFailed) continue;

    const initialResult={auto_import:true,source_title:title,source_url:pages[0].url,source_key:sourceKey,city:"Marília",official_store_ids:(flyer.stores||[]).map((s:any)=>s.id)};
    const {data:job,error:jobErr}=await db.from("flyer_import_jobs").insert({
      id:jobId,user_id:USER_ID,
      source_file_path:sourceFiles[0].path,
      source_file_name:`Max Atacadista · ${title} · ${sourceFiles.length} imagem(ns)`,
      source_files:sourceFiles,mime_type:sourceFiles[0].mime_type,
      file_hash:combinedHash,page_count:sourceFiles.length,status:"queued",
      progress_current:0,progress_total:sourceFiles.length,progress_label:"Arquivo recebido. Aguardando processamento…",
      retailer:"Max Atacadista",valid_from:null,valid_to:null,result:initialResult,
    }).select("id").single();

    if(jobErr){
      failed++;
      report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"erro",error:jobErr.message,files:sourceFiles.length,offers:0});
      continue;
    }

    await writeRegistry(db,known,{
      user_id:USER_ID,retailer:"Max Atacadista",city:"Marília",source_key:sourceKey,
      source_url:pages[0].url,source_title:title,file_hash:combinedHash,last_seen_at:now,last_downloaded_at:now,
      status:"downloaded",last_error:null,metadata_fingerprint:[id,pages.length,...unitNames].join("|"),
    });

    const pr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-flyer-job`,{
      method:"POST",
      headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},
      body:JSON.stringify({job_id:job.id,mode:"start"}),
    });
    if(!pr.ok){
      failed++;
      report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"erro ao iniciar processamento",files:sourceFiles.length,offers:0,job_id:job.id,error:"worker HTTP "+pr.status,units:unitNames});
      continue;
    }
    imported++;
    report.push({retailer:"Max Atacadista",endpoint:sourcePage,title,result:"novo enviado para processamento",files:sourceFiles.length,pages:sourceFiles.length,offers:0,job_id:job.id,units:unitNames});
  }

  report.push({retailer:"Max Atacadista",endpoint:sourcePage,result:"resumo",found:flyers.length,imported,unchanged,failed});
}


function ptMonth(value:unknown){
  const key=String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const months:Record<string,number>={janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
  return months[key]||0;
}
function isoDate(year:number,month:number,day:number){
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function kawakamiValidity(html:string){
  const plain=textOnly(html);
  let m=plain.match(/OFERTAS\s+V[ÁA]LIDAS\s+DE\s+(\d{1,2})\s+A\s+(\d{1,2})\s+DE\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+)\s+DE\s+(\d{4})/i);
  if(m){
    const month=ptMonth(m[3]),year=Number(m[4]);
    if(month) return {from:isoDate(year,month,Number(m[1])),to:isoDate(year,month,Number(m[2]))};
  }
  m=plain.match(/OFERTAS\s+V[ÁA]LIDAS\s+DE\s+(\d{1,2})\s+DE\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+)\s+A\s+(\d{1,2})\s+DE\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+)\s+DE\s+(\d{4})/i);
  if(m){
    const month1=ptMonth(m[2]),month2=ptMonth(m[4]),year=Number(m[5]);
    if(month1&&month2) return {from:isoDate(year,month1,Number(m[1])),to:isoDate(year,month2,Number(m[3]))};
  }
  return {from:null as string|null,to:null as string|null};
}
function kawakamiPages(html:string,base:string){
  const pages:string[]=[];
  for(const match of html.matchAll(/<a\b([^>]*)>/gi)){
    const attrs=match[1];
    if(!/class\s*=\s*["'][^"']*img-tabloide/i.test(attrs)) continue;
    const href=attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if(!href) continue;
    const url=abs(href.replace(/&amp;/g,"&"),base);
    if(url && !pages.includes(url)) pages.push(url);
  }
  return pages;
}

async function collectKawakami(db:any, report:any[]){
  const sourcePage="https://institucional.kawakami.com.br/oferta/marilia";
  let html="",used=sourcePage;
  try{
    const r=await fetchSafe(sourcePage);
    if(!r.ok) throw new Error("HTTP "+r.status);
    html=await r.text();
    used=r.url;
  }catch(e){
    report.push({retailer:"Kawakami",endpoint:sourcePage,result:"erro",error:String(e)});
    return;
  }

  if(!/Ofertas\s*-\s*Mar[ií]lia/i.test(textOnly(html))){
    report.push({retailer:"Kawakami",endpoint:used,result:"erro",error:"A página oficial não confirmou Marília"});
    return;
  }

  const val=kawakamiValidity(html);
  const pages=kawakamiPages(html,used);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

  if(!val.from||!val.to){
    report.push({retailer:"Kawakami",endpoint:used,result:"erro",error:"Validade oficial não identificada com segurança",files:0,offers:0});
    return;
  }
  if(val.to<today){
    report.push({retailer:"Kawakami",endpoint:used,validity:val,result:"sem novo encarte vigente",files:0,offers:0});
    return;
  }
  if(!pages.length){
    report.push({retailer:"Kawakami",endpoint:used,validity:val,result:"sem asset oficial obtível com segurança",files:0,offers:0});
    return;
  }

  const sourceKey=`kawakami:marilia:${val.from}:${val.to}`;
  const title="Ofertas";
  const now=new Date().toISOString();
  const {data:known}=await db.from("flyer_source_registry").select("*")
    .eq("user_id",USER_ID).eq("retailer","Kawakami").eq("city","Marília").eq("source_key",sourceKey).maybeSingle();

  if((known?.status==="processed"||known?.status==="unchanged") && known?.file_hash && known?.valid_from===val.from && known?.valid_to===val.to){
    await db.from("flyer_source_registry").update({last_seen_at:now,status:"processed"}).eq("id",known.id);
    report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"já conhecido antes do download",files:0,offers:0});
    report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:0,unchanged:1,failed:0});
    return;
  }

  const downloaded:any[]=[];
  for(let i=0;i<pages.length;i++){
    try{
      const r=await fetchSafe(pages[i]);
      if(!r.ok) throw new Error("HTTP "+r.status);
      const ct=r.headers.get("content-type")||"image/png";
      const bytes=new Uint8Array(await r.arrayBuffer());
      if(!bytes.length) throw new Error("imagem vazia");
      downloaded.push({index:i+1,url:pages[i],bytes,ct,hash:await sha(bytes)});
    }catch(e){
      await writeRegistry(db,known,{
        user_id:USER_ID,retailer:"Kawakami",city:"Marília",source_key:sourceKey,source_url:used,source_title:title,
        valid_from:val.from,valid_to:val.to,last_seen_at:now,status:"failed",last_error:"Página "+(i+1)+": "+String(e),
      });
      report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"erro",error:"Página "+(i+1)+": "+String(e),files:i,offers:0});
      report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:0,unchanged:0,failed:1});
      return;
    }
  }

  const combinedHash=await sha(new TextEncoder().encode(downloaded.map(p=>p.hash).join("|")));
  const [{data:saved},{data:jobs}]=await Promise.all([
    db.from("flyers").select("id").eq("user_id",USER_ID).eq("file_hash",combinedHash).limit(1),
    db.from("flyer_import_jobs").select("id,status,result").eq("user_id",USER_ID).eq("file_hash",combinedHash).in("status",["queued","processing","refining","completed"]).order("created_at",{ascending:false}).limit(1),
  ]);

  if(saved?.length){
    const flyerId=saved[0].id;
    await db.from("flyers").update({retailer:"Kawakami",title:"Kawakami · Ofertas",valid_from:val.from,valid_to:val.to,city:"Marília"}).eq("id",flyerId);
    const {count}=await db.from("flyer_items").select("id",{count:"exact",head:true}).eq("flyer_id",flyerId);
    await writeRegistry(db,known,{
      user_id:USER_ID,retailer:"Kawakami",city:"Marília",source_key:sourceKey,source_url:used,source_title:title,
      valid_from:val.from,valid_to:val.to,file_hash:combinedHash,last_seen_at:now,last_downloaded_at:now,last_processed_at:now,
      status:"processed",last_error:null,metadata_fingerprint:[val.from,val.to,pages.length].join("|"),
    });
    report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"duplicado pelo hash após download",files:downloaded.length,offers:count||0});
    report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:0,unchanged:1,failed:0});
    return;
  }

  if(jobs?.length){
    const existing=jobs[0];
    if(existing.status==="completed"){
      const fr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/finalize-flyer-job`,{
        method:"POST",headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},
        body:JSON.stringify({job_id:existing.id}),
      });
      if(fr.ok){
        const fin=await fr.json().catch(()=>({}));
        await writeRegistry(db,known,{
          user_id:USER_ID,retailer:"Kawakami",city:"Marília",source_key:sourceKey,source_url:used,source_title:title,
          valid_from:val.from,valid_to:val.to,file_hash:combinedHash,last_seen_at:now,last_downloaded_at:now,last_processed_at:now,
          status:"processed",last_error:null,metadata_fingerprint:[val.from,val.to,pages.length].join("|"),
        });
        report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"processado recuperado",files:downloaded.length,offers:fin?.offers_saved||0,job_id:existing.id});
        report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:1,unchanged:0,failed:0});
        return;
      }
    }
    report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"já em processamento",files:0,offers:0,job_id:existing.id,status:existing.status});
    report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:0,unchanged:1,failed:0});
    return;
  }

  const jobId=crypto.randomUUID();
  const sourceFiles:any[]=[];
  for(const page of downloaded){
    const ext=/png/i.test(page.ct)?"png":/webp/i.test(page.ct)?"webp":"jpg";
    const path=`${USER_ID}/imports/${jobId}/page-${String(page.index).padStart(3,"0")}.${ext}`;
    const {error}=await db.storage.from("flyers").upload(path,page.bytes,{contentType:page.ct,upsert:false});
    if(error){
      report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"erro",error:"Upload página "+page.index+": "+error.message,files:sourceFiles.length,offers:0});
      report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:0,unchanged:0,failed:1});
      return;
    }
    sourceFiles.push({path,name:`Kawakami Marília - página ${page.index}.${ext}`,mime_type:page.ct,size:page.bytes.length});
  }

  const initialResult={auto_import:true,source_title:title,source_url:used,source_key:sourceKey,city:"Marília",valid_from:val.from,valid_to:val.to,validity_locked:true};
  const {data:job,error:jobErr}=await db.from("flyer_import_jobs").insert({
    id:jobId,user_id:USER_ID,source_file_path:sourceFiles[0].path,source_file_name:`Kawakami · Ofertas ${val.from} a ${val.to} · ${sourceFiles.length} imagem(ns)`,
    source_files:sourceFiles,mime_type:sourceFiles[0].mime_type,file_hash:combinedHash,page_count:sourceFiles.length,status:"queued",
    progress_current:0,progress_total:sourceFiles.length,progress_label:"Arquivo recebido. Aguardando processamento…",
    retailer:"Kawakami",valid_from:val.from,valid_to:val.to,result:initialResult,
  }).select("id").single();

  if(jobErr){
    report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"erro",error:jobErr.message,files:sourceFiles.length,offers:0});
    report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:0,unchanged:0,failed:1});
    return;
  }

  await writeRegistry(db,known,{
    user_id:USER_ID,retailer:"Kawakami",city:"Marília",source_key:sourceKey,source_url:used,source_title:title,
    valid_from:val.from,valid_to:val.to,file_hash:combinedHash,last_seen_at:now,last_downloaded_at:now,status:"downloaded",last_error:null,
    metadata_fingerprint:[val.from,val.to,pages.length].join("|"),
  });

  const pr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-flyer-job`,{
    method:"POST",headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},
    body:JSON.stringify({job_id:job.id,mode:"start"}),
  });
  if(!pr.ok){
    report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"erro ao iniciar processamento",files:sourceFiles.length,offers:0,job_id:job.id,error:"worker HTTP "+pr.status});
    report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:0,unchanged:0,failed:1});
    return;
  }
  report.push({retailer:"Kawakami",endpoint:used,title,validity:val,result:"novo enviado para processamento",files:sourceFiles.length,pages:sourceFiles.length,offers:0,job_id:job.id});
  report.push({retailer:"Kawakami",endpoint:used,result:"resumo",found:1,imported:1,unchanged:0,failed:0});
}


function confiancaPublications(html:string,base:string){
  const rows:{url:string,valid_from:string|null,valid_to:string|null}[]=[];
  const seen=new Set<string>();
  const re=/(?:href|src)\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
  for(const match of html.matchAll(re)){
    const url=abs(match[1].replace(/&amp;/g,"&"),base);
    if(!url || !/clienteconfianca\.com\.br/i.test(url) || seen.has(clean(url))) continue;
    seen.add(clean(url));
    const start=Math.max(0,(match.index||0)-300);
    const nearby=html.slice(start,Math.min(html.length,(match.index||0)+3500));
    const dm=nearby.match(/hideWidgetByDate\('[^']+'\s*,\s*'True'\s*==\s*'True'\s*,\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*'True'\s*==\s*'True'\s*,\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})/i);
    rows.push({
      url,
      valid_from:dm?isoDate(Number(dm[1]),Number(dm[2]),Number(dm[3])):null,
      valid_to:dm?isoDate(Number(dm[4]),Number(dm[5]),Number(dm[6])):null,
    });
  }
  return rows;
}

async function collectConfianca(db:any, report:any[]){
  const sourcePage="https://clienteconfianca.com.br/ofertas-marilia.html";
  let html="",used=sourcePage;
  try{
    const r=await fetchSafe(sourcePage);
    if(!r.ok) throw new Error("HTTP "+r.status);
    html=await r.text();
    used=r.url;
  }catch(e){
    report.push({retailer:"Confiança",endpoint:sourcePage,result:"erro",error:String(e)});
    return;
  }

  const plain=textOnly(html);
  if(!/Mar[ií]lia/i.test(plain) && !/Ofertas Confian[cç]a\s*-\s*Mar[ií]lia/i.test(html)){
    report.push({retailer:"Confiança",endpoint:used,result:"erro",error:"A página oficial não confirmou Marília"});
    return;
  }

  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const publications=confiancaPublications(html,used).filter((p)=>p.valid_to && p.valid_to>=today);
  if(!publications.length){
    report.push({retailer:"Confiança",endpoint:used,result:"sem asset oficial obtível com segurança",files:0,offers:0});
    report.push({retailer:"Confiança",endpoint:used,result:"resumo",found:0,imported:0,unchanged:0,failed:0});
    return;
  }

  let imported=0,unchanged=0,failed=0;
  for(const publication of publications){
    const pdfUrl=publication.url;
    const sourceValidity={from:publication.valid_from,to:publication.valid_to};
    const canonical=clean(pdfUrl);
    const filename=decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop()||"tabloide.pdf");
    const sourceKey="confianca:marilia:"+canonical;
    const title="Ofertas Marília";
    const now=new Date().toISOString();

    const {data:known}=await db.from("flyer_source_registry").select("*")
      .eq("user_id",USER_ID).eq("retailer","Confiança").eq("city","Marília").eq("source_key",sourceKey).maybeSingle();

    if((known?.status==="processed"||known?.status==="unchanged"||known?.status==="expired") && known?.file_hash){
      await db.from("flyer_source_registry").update({last_seen_at:now,status:known.status==="unchanged"?"processed":known.status}).eq("id",known.id);
      report.push({
        retailer:"Confiança",endpoint:used,title,
        validity:{from:known.valid_from||null,to:known.valid_to||null},
        result:known.status==="expired"?"expirado já conhecido":"já conhecido antes do download",
        files:0,offers:0,
      });
      unchanged++;
      continue;
    }

    let response:Response;
    try{response=await fetchSafe(pdfUrl)}catch(e){
      failed++;
      await writeRegistry(db,known,{
        user_id:USER_ID,retailer:"Confiança",city:"Marília",source_key:sourceKey,source_url:canonical,source_title:title,
        last_seen_at:now,status:"failed",last_error:String(e),
      });
      report.push({retailer:"Confiança",endpoint:used,title,result:"erro",error:String(e),files:0,offers:0});
      continue;
    }
    if(!response.ok){
      failed++;
      report.push({retailer:"Confiança",endpoint:used,title,result:"erro",error:"PDF HTTP "+response.status,files:0,offers:0});
      continue;
    }

    const ct=response.headers.get("content-type")||"application/pdf";
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(!bytes.length || (!/pdf/i.test(ct) && !/\.pdf(?:\?|$)/i.test(pdfUrl))){
      failed++;
      report.push({retailer:"Confiança",endpoint:used,title,result:"erro",error:"Arquivo oficial não é PDF válido",files:0,offers:0});
      continue;
    }

    const hash=await sha(bytes);
    const [{data:saved},{data:jobs}]=await Promise.all([
      db.from("flyers").select("id,valid_from,valid_to").eq("user_id",USER_ID).eq("file_hash",hash).limit(1),
      db.from("flyer_import_jobs").select("id,status,result,valid_from,valid_to").eq("user_id",USER_ID).eq("file_hash",hash)
        .in("status",["queued","processing","refining","completed"]).order("created_at",{ascending:false}).limit(1),
    ]);

    if(saved?.length){
      const flyer=saved[0];
      const {count}=await db.from("flyer_items").select("id",{count:"exact",head:true}).eq("flyer_id",flyer.id);
      await writeRegistry(db,known,{
        user_id:USER_ID,retailer:"Confiança",city:"Marília",source_key:sourceKey,source_url:canonical,source_title:title,
        valid_from:flyer.valid_from||sourceValidity.from||null,valid_to:flyer.valid_to||sourceValidity.to||null,file_hash:hash,last_seen_at:now,last_downloaded_at:now,
        last_processed_at:now,status:"processed",last_error:null,
      });
      report.push({retailer:"Confiança",endpoint:used,title,validity:{from:flyer.valid_from||sourceValidity.from||null,to:flyer.valid_to||sourceValidity.to||null},result:"duplicado pelo hash após download",files:1,offers:count||0});
      unchanged++;
      continue;
    }

    if(jobs?.length){
      const existing=jobs[0];
      if(existing.status==="completed"){
        const fr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/finalize-flyer-job`,{
          method:"POST",
          headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},
          body:JSON.stringify({job_id:existing.id}),
        });
        const body=await fr.json().catch(()=>({}));
        if(fr.ok){
          await writeRegistry(db,known,{
            user_id:USER_ID,retailer:"Confiança",city:"Marília",source_key:sourceKey,source_url:canonical,source_title:title,
            valid_from:body?.valid_from||existing.valid_from||sourceValidity.from||null,valid_to:body?.valid_to||existing.valid_to||sourceValidity.to||null,
            file_hash:hash,last_seen_at:now,last_downloaded_at:now,last_processed_at:now,status:"processed",last_error:null,
          });
          report.push({retailer:"Confiança",endpoint:used,title,validity:{from:body?.valid_from||null,to:body?.valid_to||null},result:"processado recuperado",files:1,offers:body?.offers_saved||0,job_id:existing.id});
          imported++;
          continue;
        }
        if(body?.error==="FLYER_EXPIRED"){
          await writeRegistry(db,known,{
            user_id:USER_ID,retailer:"Confiança",city:"Marília",source_key:sourceKey,source_url:canonical,source_title:title,
            valid_from:existing.valid_from||sourceValidity.from||null,valid_to:body?.valid_to||existing.valid_to||sourceValidity.to||null,file_hash:hash,
            last_seen_at:now,last_downloaded_at:now,status:"expired",last_error:null,
          });
          report.push({retailer:"Confiança",endpoint:used,title,result:"expirado",files:1,offers:0,job_id:existing.id});
          unchanged++;
          continue;
        }
      }
      report.push({retailer:"Confiança",endpoint:used,title,result:"já em processamento",files:0,offers:0,job_id:existing.id,status:existing.status});
      unchanged++;
      continue;
    }

    const pages=pdfPageCount(bytes);
    const path=`auto/marilia/confianca/${hash}.pdf`;
    const {error:upErr}=await db.storage.from("flyers").upload(path,bytes,{contentType:"application/pdf",upsert:false});
    if(upErr && !/already exists|resource already exists|duplicate/i.test(upErr.message)){
      failed++;
      report.push({retailer:"Confiança",endpoint:used,title,result:"erro",error:upErr.message,files:0,offers:0});
      continue;
    }

    const initialResult={auto_import:true,source_title:title,source_url:canonical,source_key:sourceKey,city:"Marília",valid_from:sourceValidity.from,valid_to:sourceValidity.to,validity_locked:Boolean(sourceValidity.from&&sourceValidity.to)};
    const {data:job,error:jobErr}=await db.from("flyer_import_jobs").insert({
      user_id:USER_ID,source_file_path:path,source_file_name:`Confiança - Marília - ${filename}`,mime_type:"application/pdf",
      file_hash:hash,page_count:pages,status:"queued",progress_current:0,progress_total:pages,
      progress_label:"Arquivo recebido. Aguardando processamento…",retailer:"Confiança",valid_from:sourceValidity.from,valid_to:sourceValidity.to,result:initialResult,
    }).select("id").single();

    if(jobErr){
      failed++;
      report.push({retailer:"Confiança",endpoint:used,title,result:"erro",error:jobErr.message,files:1,offers:0});
      continue;
    }

    await writeRegistry(db,known,{
      user_id:USER_ID,retailer:"Confiança",city:"Marília",source_key:sourceKey,source_url:canonical,source_title:title,
      valid_from:sourceValidity.from,valid_to:sourceValidity.to,file_hash:hash,last_seen_at:now,last_downloaded_at:now,status:"downloaded",last_error:null,
      metadata_fingerprint:[canonical,sourceValidity.from,sourceValidity.to].join("|"),
    });

    const pr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-flyer-job`,{
      method:"POST",
      headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},
      body:JSON.stringify({job_id:job.id,mode:"start"}),
    });
    if(!pr.ok){
      failed++;
      report.push({retailer:"Confiança",endpoint:used,title,result:"erro ao iniciar processamento",files:1,pages,offers:0,job_id:job.id,error:"worker HTTP "+pr.status});
      continue;
    }

    imported++;
    report.push({retailer:"Confiança",endpoint:used,title,result:"novo enviado para processamento",files:1,pages,offers:0,job_id:job.id});
  }

  report.push({retailer:"Confiança",endpoint:used,result:"resumo",found:publications.length,imported,unchanged,failed});
}


const TAUSTE_BROWSER_UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function tausteNormalize(value:unknown){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
}

function tausteCollectionHash(publication:any){
  const direct=String(publication?.directLink||"");
  const directMatch=direct.match(/-([a-z0-9_-]{8,})\.html(?:$|[?#])/i);
  if(directMatch?.[1]) return directMatch[1];
  const cover=String(publication?.coverImgSrc||"");
  const coverMatch=cover.match(/\/collections\/([^/]+)\//i);
  return coverMatch?.[1]||"";
}

async function taustePublications(){
  const profile="https://www.flipsnack.com/taustesupermercado/";
  const api=new URL("https://api.flipsnack.com/v2/publications/related");
  api.searchParams.set("p","1");
  api.searchParams.set("accountId","9D99E5AF8D6");
  api.searchParams.set("excludeId","0");
  api.searchParams.set("userUrl",profile);
  api.searchParams.set("folderHash","");
  api.searchParams.set("searchAfter","0");
  api.searchParams.set("searchKey","");
  const r=await fetch(api,{headers:{"user-agent":TAUSTE_BROWSER_UA,"accept":"application/json,*/*","referer":profile}});
  if(!r.ok) throw new Error("Flipsnack API HTTP "+r.status);
  const data=await r.json();
  if(!Array.isArray(data)) throw new Error("Resposta inesperada do perfil oficial Tauste");
  return data.filter((p:any)=>{
    const name=tausteNormalize(p?.name);
    return name.includes("ofertas tauste") && name.includes("marilia") && tausteCollectionHash(p);
  });
}

async function tausteReaderPages(collectionHash:string,fullView:string){
  const accountId="9D99E5AF8D6";
  const token=btoa(accountId+"+"+collectionHash);
  const authUrl=new URL("https://content-private.flipsnack.com/authorization");
  authUrl.searchParams.set("hash",token);
  authUrl.searchParams.set("domain","www.flipsnack.com");
  const auth=await fetch(authUrl,{
    headers:{
      "user-agent":TAUSTE_BROWSER_UA,
      "accept":"application/json,*/*",
      "referer":fullView,
      "origin":"https://player.flipsnack.com",
    },
  });
  if(!auth.ok) throw new Error("Flipsnack authorization HTTP "+auth.status);
  const authData=await auth.json();
  const signature=String(authData?.signature?.[collectionHash]||"");
  if(!signature) throw new Error("Flipsnack não forneceu assinatura para a publicação");

  const dataUrl="https://d3u72tnj701eui.cloudfront.net/"+accountId+"/collections/"+collectionHash+"/data.json?"+signature;
  const dataResponse=await fetch(dataUrl,{headers:{"user-agent":TAUSTE_BROWSER_UA,"accept":"application/json,*/*","referer":"https://player.flipsnack.com/"}});
  if(!dataResponse.ok) throw new Error("Flipsnack data.json HTTP "+dataResponse.status);
  const data=await dataResponse.json();
  const title=String(data?.properties?.title||"").trim();
  if(!tausteNormalize(title).includes("marilia")) throw new Error("A publicação do Flipsnack não confirmou Marília");

  const rawOrder=Array.isArray(data?.pages?.order)?data.pages.order:[];
  const ids=rawOrder.flat().map((id:any)=>String(id||"").trim()).filter(Boolean);
  if(!ids.length) throw new Error("A publicação Tauste não possui páginas");

  const pages=ids.map((id:string,index:number)=>{
    const page=data?.pages?.data?.[id]||{};
    const coverVersion=Number(page?.coverVersion)||1;
    return {
      id,
      index:index+1,
      url:"https://d3u72tnj701eui.cloudfront.net/"+accountId+"/collections/"+collectionHash+"/covers/"+encodeURIComponent(id)+"/original?"+signature+"&v="+coverVersion,
      type:String(page?.type||"jpg"),
      width:Number(page?.width)||null,
      height:Number(page?.height)||null,
    };
  });
  return {pages,title:title||"Ofertas Tauste Marília",updated_at:data?.properties?.dateLastUpdate||null};
}

async function collectTauste(db:any, report:any[], onlyTitle=""){
  const sourcePage="https://www.flipsnack.com/taustesupermercado/";
  let publications:any[]=[];
  try{
    publications=await taustePublications();
  }catch(e){
    report.push({retailer:"Tauste",endpoint:sourcePage,result:"erro",error:String(e),files:0,offers:0});
    report.push({retailer:"Tauste",endpoint:sourcePage,result:"resumo",found:0,imported:0,unchanged:0,failed:1});
    return;
  }

  if(onlyTitle){
    const wanted=tausteNormalize(onlyTitle);
    publications=publications.filter((p:any)=>tausteNormalize(p?.name)===wanted || tausteNormalize(String(p?.name||"").replace(/^ofertas\s+tauste\s+/i,""))===wanted);
  }

  let imported=0,unchanged=0,failed=0;
  for(const publication of publications){
    const collectionHash=tausteCollectionHash(publication);
    const sourceTitle=String(publication?.name||"Ofertas Tauste Marília").trim();
    const title=sourceTitle.replace(/^Ofertas\s+Tauste\s+/i,"Ofertas ");
    const publishedAt=String(publication?.datePublished||"").trim()||null;
    const directLink=String(publication?.directLink||"").trim();
    const fullView=directLink
      ? "https://www.flipsnack.com/taustesupermercado/"+directLink.replace(/\.html(?:$|[?#])/i,"/full-view.html")
      : sourcePage;
    const sourceKey="tauste:flipsnack:"+collectionHash;
    const now=new Date().toISOString();

    const {data:known}=await db.from("flyer_source_registry").select("*")
      .eq("user_id",USER_ID).eq("retailer","Tauste").eq("city","Marília").eq("source_key",sourceKey).maybeSingle();

    if(known && ["processed","unchanged","expired"].includes(String(known.status||"")) && known.file_hash){
      await db.from("flyer_source_registry").update({
        last_seen_at:now,
        status:known.status==="unchanged"?"processed":known.status,
        source_url:fullView,
        source_title:title,
        metadata_fingerprint:[collectionHash,publishedAt||""].join("|"),
      }).eq("id",known.id);
      let offers=0;
      if(known.status!=="expired"){
        const {data:fly}=await db.from("flyers").select("id").eq("user_id",USER_ID).eq("file_hash",known.file_hash).maybeSingle();
        if(fly?.id){
          const {count}=await db.from("flyer_items").select("id",{count:"exact",head:true}).eq("flyer_id",fly.id);
          offers=count||0;
        }
      }
      report.push({
        retailer:"Tauste",endpoint:sourcePage,title,
        validity:{from:known.valid_from||null,to:known.valid_to||null},
        result:known.status==="expired"?"expirado já conhecido":"já conhecido antes do download",
        files:0,offers,published_at:publishedAt,
      });
      unchanged++;
      continue;
    }

    let reader:any;
    try{
      reader=await tausteReaderPages(collectionHash,fullView);
    }catch(e){
      failed++;
      await writeRegistry(db,known,{
        user_id:USER_ID,retailer:"Tauste",city:"Marília",source_key:sourceKey,source_url:fullView,source_title:title,
        metadata_fingerprint:[collectionHash,publishedAt||""].join("|"),last_seen_at:now,status:"failed",last_error:String(e),
      });
      report.push({retailer:"Tauste",endpoint:sourcePage,title,result:"erro",error:String(e),files:0,offers:0,published_at:publishedAt});
      continue;
    }

    const downloaded:any[]=[];
    let pageError:any=null;
    for(const page of reader.pages){
      try{
        const r=await fetch(page.url,{headers:{"user-agent":TAUSTE_BROWSER_UA,"accept":"image/*,*/*","referer":"https://player.flipsnack.com/"}});
        if(!r.ok) throw new Error("HTTP "+r.status);
        const ct=r.headers.get("content-type")||"image/jpeg";
        if(!/image\//i.test(ct)) throw new Error("content-type inesperado: "+ct);
        const bytes=new Uint8Array(await r.arrayBuffer());
        if(!bytes.length) throw new Error("imagem vazia");
        downloaded.push({...page,bytes,ct,hash:await sha(bytes)});
      }catch(e){
        pageError=new Error("Página "+page.index+": "+String(e));
        break;
      }
    }

    if(pageError||!downloaded.length){
      failed++;
      await writeRegistry(db,known,{
        user_id:USER_ID,retailer:"Tauste",city:"Marília",source_key:sourceKey,source_url:fullView,source_title:title,
        metadata_fingerprint:[collectionHash,publishedAt||"",reader?.pages?.length||0].join("|"),
        last_seen_at:now,status:"failed",last_error:String(pageError||"Nenhuma página baixada"),
      });
      report.push({retailer:"Tauste",endpoint:sourcePage,title,result:"erro",error:String(pageError||"Nenhuma página baixada"),files:downloaded.length,offers:0,published_at:publishedAt});
      continue;
    }

    const combinedHash=await sha(new TextEncoder().encode(downloaded.map(p=>p.hash).join("|")));
    const [{data:saved},{data:jobs}]=await Promise.all([
      db.from("flyers").select("id,valid_from,valid_to").eq("user_id",USER_ID).eq("file_hash",combinedHash).limit(1),
      db.from("flyer_import_jobs").select("id,status,result,valid_from,valid_to").eq("user_id",USER_ID).eq("file_hash",combinedHash)
        .in("status",["queued","processing","refining","completed"]).order("created_at",{ascending:false}).limit(1),
    ]);

    if(saved?.length){
      const flyer=saved[0];
      const {count}=await db.from("flyer_items").select("id",{count:"exact",head:true}).eq("flyer_id",flyer.id);
      await writeRegistry(db,known,{
        user_id:USER_ID,retailer:"Tauste",city:"Marília",source_key:sourceKey,source_url:fullView,source_title:title,
        valid_from:flyer.valid_from||null,valid_to:flyer.valid_to||null,file_hash:combinedHash,
        metadata_fingerprint:[collectionHash,publishedAt||"",downloaded.length].join("|"),
        last_seen_at:now,last_downloaded_at:now,last_processed_at:now,status:"processed",last_error:null,
      });
      report.push({retailer:"Tauste",endpoint:sourcePage,title,validity:{from:flyer.valid_from||null,to:flyer.valid_to||null},result:"duplicado pelo hash após download",files:downloaded.length,offers:count||0,published_at:publishedAt});
      unchanged++;
      continue;
    }

    if(jobs?.length){
      const existing=jobs[0];
      if(existing.status==="completed"){
        const fr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/finalize-flyer-job`,{
          method:"POST",
          headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},
          body:JSON.stringify({job_id:existing.id}),
        });
        const fin=await fr.json().catch(()=>({}));
        if(fr.ok){
          await writeRegistry(db,known,{
            user_id:USER_ID,retailer:"Tauste",city:"Marília",source_key:sourceKey,source_url:fullView,source_title:title,
            valid_from:fin?.valid_from||existing.valid_from||null,valid_to:fin?.valid_to||existing.valid_to||null,
            file_hash:combinedHash,metadata_fingerprint:[collectionHash,publishedAt||"",downloaded.length].join("|"),
            last_seen_at:now,last_downloaded_at:now,last_processed_at:now,status:"processed",last_error:null,
          });
          report.push({retailer:"Tauste",endpoint:sourcePage,title,validity:{from:fin?.valid_from||null,to:fin?.valid_to||null},result:"processado recuperado",files:downloaded.length,offers:fin?.offers_saved||0,job_id:existing.id,published_at:publishedAt});
          imported++;
          continue;
        }
        if(fin?.error==="FLYER_EXPIRED"){
          await writeRegistry(db,known,{
            user_id:USER_ID,retailer:"Tauste",city:"Marília",source_key:sourceKey,source_url:fullView,source_title:title,
            valid_from:existing.valid_from||null,valid_to:fin?.valid_to||existing.valid_to||null,file_hash:combinedHash,
            metadata_fingerprint:[collectionHash,publishedAt||"",downloaded.length].join("|"),
            last_seen_at:now,last_downloaded_at:now,status:"expired",last_error:null,
          });
          report.push({retailer:"Tauste",endpoint:sourcePage,title,validity:{from:existing.valid_from||null,to:fin?.valid_to||existing.valid_to||null},result:"expirado",files:downloaded.length,offers:0,job_id:existing.id,published_at:publishedAt});
          unchanged++;
          continue;
        }
      }
      report.push({retailer:"Tauste",endpoint:sourcePage,title,result:"já em processamento",files:0,offers:0,job_id:existing.id,status:existing.status,published_at:publishedAt});
      unchanged++;
      continue;
    }

    const jobId=crypto.randomUUID();
    const sourceFiles:any[]=[];
    let uploadError:any=null;
    for(const page of downloaded){
      const path=`${USER_ID}/imports/${jobId}/page-${String(page.index).padStart(3,"0")}.jpg`;
      const {error}=await db.storage.from("flyers").upload(path,page.bytes,{contentType:page.ct||"image/jpeg",upsert:false});
      if(error){uploadError=error;break}
      sourceFiles.push({path,name:`Tauste Marília - página ${page.index}.jpg`,mime_type:page.ct||"image/jpeg",size:page.bytes.length});
    }
    if(uploadError){
      failed++;
      report.push({retailer:"Tauste",endpoint:sourcePage,title,result:"erro",error:"Upload: "+uploadError.message,files:sourceFiles.length,offers:0,published_at:publishedAt});
      continue;
    }

    const initialResult={
      auto_import:true,source_title:title,source_url:fullView,source_key:sourceKey,city:"Marília",
      flipsnack_hash:collectionHash,published_at:publishedAt,validity_locked:false,
    };
    const {data:job,error:jobErr}=await db.from("flyer_import_jobs").insert({
      id:jobId,user_id:USER_ID,source_file_path:sourceFiles[0].path,
      source_file_name:`Tauste · Marília · Flipsnack ${collectionHash} · ${sourceFiles.length} imagem(ns)`,
      source_files:sourceFiles,mime_type:sourceFiles[0].mime_type,file_hash:combinedHash,page_count:sourceFiles.length,status:"queued",
      progress_current:0,progress_total:sourceFiles.length,progress_label:"Arquivo recebido. Aguardando processamento…",
      retailer:"Tauste",valid_from:null,valid_to:null,result:initialResult,
    }).select("id").single();

    if(jobErr){
      failed++;
      report.push({retailer:"Tauste",endpoint:sourcePage,title,result:"erro",error:jobErr.message,files:sourceFiles.length,offers:0,published_at:publishedAt});
      continue;
    }

    await writeRegistry(db,known,{
      user_id:USER_ID,retailer:"Tauste",city:"Marília",source_key:sourceKey,source_url:fullView,source_title:title,
      file_hash:combinedHash,metadata_fingerprint:[collectionHash,publishedAt||"",downloaded.length].join("|"),
      last_seen_at:now,last_downloaded_at:now,status:"downloaded",last_error:null,
    });

    const pr=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-flyer-job`,{
      method:"POST",
      headers:{authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,"content-type":"application/json"},
      body:JSON.stringify({job_id:job.id,mode:"start"}),
    });
    if(!pr.ok){
      failed++;
      report.push({retailer:"Tauste",endpoint:sourcePage,title,result:"erro ao iniciar processamento",files:sourceFiles.length,offers:0,job_id:job.id,error:"worker HTTP "+pr.status,published_at:publishedAt});
      continue;
    }
    imported++;
    report.push({retailer:"Tauste",endpoint:sourcePage,title,result:"novo enviado para processamento",files:sourceFiles.length,pages:sourceFiles.length,offers:0,job_id:job.id,published_at:publishedAt});
  }

  report.push({retailer:"Tauste",endpoint:sourcePage,result:"resumo",found:publications.length,imported,unchanged,failed});
}

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
  if(src.retailer==="Max Atacadista"){
    await collectMaxAtacadista(db,report,requestedTitle);
    continue;
  }
  if(src.retailer==="Tauste"){
    await collectTauste(db,report,requestedTitle);
    continue;
  }
  if(src.retailer==="Kawakami"){
    await collectKawakami(db,report);
    continue;
  }
  if(src.retailer==="Confiança"){
    await collectConfianca(db,report);
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