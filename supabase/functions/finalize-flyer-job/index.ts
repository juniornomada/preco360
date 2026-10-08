import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status:number, body:unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession:false, autoRefreshToken:false } },
  );
}

async function callerIdentity(req:Request) {
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if (token && service && token===service) return { service:true, userId:null as string|null };
  if (!token) return { service:false, userId:null as string|null };
  const url=Deno.env.get("SUPABASE_URL");
  const anon=Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return { service:false, userId:null as string|null };
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.getUser(token);
  return { service:false, userId:error?null:(data.user?.id??null) };
}

function normalize(value:unknown) {
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/([a-z])\.([a-z])/g,"$1 $2")
    .replace(/[^a-z0-9]+/g," ").trim();
}

function positive(value:unknown) {
  const n=Number(value);
  return Number.isFinite(n)&&n>0?n:null;
}

function paymentConditionText(notes:unknown) {
  return (Array.isArray(notes)?notes:[])
    .map((note)=>String(note??""))
    .join(" ");
}

function isPaymentRestrictedPrice(notes:unknown) {
  const text=paymentConditionText(notes);
  return /(taustepay|pagando.{0,40}cart[aã]o|cart[aã]o.{0,40}pagando|cart[aã]o\s+elo|credifatto|cart[aã]o.{0,30}muffato|muffato.{0,30}cart[aã]o)/i.test(text);
}

function hasExplicitAlternativePaymentPrice(notes:unknown, advertisedPrice:unknown) {
  const advertised=positive(advertisedPrice);
  if (advertised===null) return false;

  const amounts=[...paymentConditionText(notes).matchAll(/R\$\s*(\d{1,4}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi)]
    .map((match)=>{
      const raw=String(match[1]??"").replace(/\./g,"").replace(",",".");
      return Number(raw);
    })
    .filter((value)=>Number.isFinite(value)&&value>0);

  return amounts.some((value)=>Math.abs(value-advertised)>0.005);
}

function packageInfo(quantityValue:unknown, unitValue:unknown) {
  const q=Number(quantityValue);
  const unit=normalize(unitValue);
  if (!Number.isFinite(q)||q<=0||!unit) return null;
  if (unit==="g") return {quantity:q,unit:"g",baseUnit:"kg",baseQuantity:q/1000};
  if (unit==="kg") return {quantity:q,unit:"kg",baseUnit:"kg",baseQuantity:q};
  if (unit==="ml") return {quantity:q,unit:"ml",baseUnit:"l",baseQuantity:q/1000};
  if (unit==="l"||unit==="lt") return {quantity:q,unit:"l",baseUnit:"l",baseQuantity:q};
  if (["un","und","unid","unidade","unidades"].includes(unit)) return {quantity:q,unit:"un",baseUnit:"un",baseQuantity:q};
  return null;
}

function displayName(offer:any) {
  let name=String(offer?.product_name??"").trim();
  const brand=String(offer?.brand??"").trim();
  const key=normalize(name);
  if (brand && !key.includes(normalize(brand))) name=(name+" "+brand).trim();
  const pkg=packageInfo(offer?.package_quantity,offer?.package_unit);
  if (pkg) {
    const quantity=Number.isInteger(pkg.quantity)?String(pkg.quantity):String(pkg.quantity).replace(".",",");
    const label=quantity+pkg.unit;
    if (!normalize(name).includes(normalize(label))) name=(name+" "+label).trim();
  }
  return name.replace(/\s+/g," ").trim();
}

function normalizedPricing(offer:any) {
  const price=positive(offer?.price)!;
  let pkg=packageInfo(offer?.package_quantity,offer?.package_unit);
  if (!pkg && normalize(offer?.price_basis_unit)!=="un") {
    pkg=packageInfo(offer?.price_basis_quantity,offer?.price_basis_unit);
  }
  if (!pkg?.baseQuantity) return { normalizedPrice:price, baseUnit:"un" };
  return { normalizedPrice:price/pkg.baseQuantity, baseUnit:pkg.baseUnit };
}

function structuredLimitAndNotes(offer:any) {
  const rawNotes=Array.isArray(offer?.notes)?offer.notes:[];
  const kept:string[]=[];
  let inferredLimit="";

  for (const raw of rawNotes) {
    const note=String(raw??"").replace(/\s+/g," ").trim();
    if (!note) continue;
    const text=normalize(note);
    const looksLikeLimit=
      (
        /\b(limite|limitado|limitada|maximo|maxima|max)\b/.test(text) ||
        /\bpor (pessoa|cliente|cpf|compra)\b/.test(text)
      ) &&
      /\b\d+(?:[.,]\d+)?\s*(kg|g|l|ml|un|und|unid|unidade|unidades)\b/.test(text);

    if (looksLikeLimit) {
      if (!inferredLimit) inferredLimit=note;
      continue;
    }

    kept.push(note);
  }

  return {
    purchaseLimit:String(offer?.purchase_limit??"").trim()||inferredLimit||null,
    notes:kept,
  };
}

Deno.serve(async(req:Request)=>{
  if (req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if (req.method!=="POST") return json(405,{error:"METHOD_NOT_ALLOWED"});
  try {
    const body=await req.json();
    const jobId=String(body?.job_id??"").trim();
    if (!jobId) return json(400,{error:"JOB_ID_REQUIRED"});

    const supabase=db();
    const {data:job,error:jobError}=await supabase.from("flyer_import_jobs").select("*").eq("id",jobId).single();
    if (jobError||!job) return json(404,{error:"JOB_NOT_FOUND"});

    const caller=await callerIdentity(req);
    if (!caller.service && caller.userId!==job.user_id) return json(403,{error:"FORBIDDEN"});
    if (job.status!=="completed") return json(409,{error:"JOB_NOT_COMPLETED",status:job.status,message:job.error_message??null});

    const offers=(Array.isArray(job.result?.offers)?job.result.offers:[])
      .filter((offer:any)=>String(offer?.product_name??"").trim() && positive(offer?.price) && Number(offer?.confidence??0)>=0.72);
    if (!offers.length) return json(422,{error:"NO_VALID_OFFERS"});

    const retailer=String(job.result?.retailer??job.retailer??"").trim()||"Mercado";
    const validFrom=job.result?.valid_from??job.valid_from??null;
    const validTo=job.result?.valid_to??job.valid_to??null;
    const sourceTitle=String(job.result?.source_title??"").trim();
    const title=sourceTitle?retailer+" · "+sourceTitle:retailer+" · Ofertas";

    if (job.result?.auto_import === true) {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      if (!validTo) {
        await supabase.from("flyer_source_registry").update({
          status:"date_validation_failed",
          last_error:"Não foi possível confirmar a data final de validade no encarte.",
          last_seen_at:new Date().toISOString(),
        }).eq("user_id",job.user_id).eq("file_hash",job.file_hash);
        return json(422,{error:"VALIDITY_NOT_CONFIRMED",job_id:jobId});
      }
      if (String(validTo) < today) {
        await supabase.from("flyer_source_registry").update({
          status:"expired",
          last_error:null,
          last_seen_at:new Date().toISOString(),
        }).eq("user_id",job.user_id).eq("file_hash",job.file_hash);
        return json(409,{error:"FLYER_EXPIRED",job_id:jobId,valid_to:validTo,today});
      }
    }
    const pageCount=Math.max(1,Math.trunc(Number(job.result?.page_count??job.page_count??1)));

    const {data:existing,error:existingError}=await supabase.from("flyers")
      .select("id,source_file_path")
      .eq("user_id",job.user_id)
      .eq("file_hash",job.file_hash)
      .maybeSingle();
    if (existingError) throw existingError;

    let flyerId:string;
    if (existing?.id) {
      flyerId=existing.id;
      const {error:updateError}=await supabase.from("flyers").update({
        retailer,title,valid_from:validFrom,valid_to:validTo,city:"Marília",
        source_type:"pdf",source_file_name:job.source_file_name,
        source_file_path:job.source_file_path||existing.source_file_path,
        source_files:Array.isArray(job.source_files)?job.source_files:[],
        file_hash:job.file_hash,page_count:pageCount,
      }).eq("id",flyerId);
      if (updateError) throw updateError;
      const {error:deleteError}=await supabase.from("flyer_items").delete().eq("flyer_id",flyerId);
      if (deleteError) throw deleteError;
    } else {
      const {data:created,error:createError}=await supabase.from("flyers").insert({
        user_id:job.user_id,retailer,title,valid_from:validFrom,valid_to:validTo,city:"Marília",
        source_type:"pdf",source_file_name:job.source_file_name,
        source_file_path:job.source_file_path,source_files:Array.isArray(job.source_files)?job.source_files:[],
        file_hash:job.file_hash,page_count:pageCount,
      }).select("id").single();
      if (createError) throw createError;
      flyerId=created.id;
    }

    const rows=offers.map((offer:any)=>{
      const structured=structuredLimitAndNotes(offer);
      const paymentRestricted=isPaymentRestrictedPrice(structured.notes);
      const extractedClub=positive(offer?.club_price);

      // If the only captured price is explicitly tied to a store payment method,
      // we do not know the user's eligible regular price and must not save it.
      if (
        paymentRestricted &&
        extractedClub===null &&
        !hasExplicitAlternativePaymentPrice(structured.notes,offer?.price)
      ) {
        console.warn("Skipping payment-restricted offer without verified regular price", {
          product_name: offer?.product_name,
          retailer,
          notes: offer?.notes,
        });
        return null;
      }

      const name=displayName(offer);
      const pricing=normalizedPricing(offer);
      // Payment-method discounts are never treated as club/member prices.
      const club=paymentRestricted?null:extractedClub;

      return {
        flyer_id:flyerId,
        user_id:job.user_id,
        raw_name:name,
        normalized_name:normalize(name),
        brand:String(offer?.brand??"").trim()||null,
        package_quantity:positive(offer?.package_quantity),
        package_unit:String(offer?.package_unit??"").trim()||null,
        advertised_price:Number(offer.price),
        base_unit:pricing.baseUnit,
        normalized_price:pricing.normalizedPrice,
        club_price:club!==null,
        club_advertised_price:club,
        included_types:Array.isArray(offer?.included_types)?offer.included_types:[],
        excluded_types:Array.isArray(offer?.excluded_types)?offer.excluded_types:[],
        store_restrictions:Array.isArray(offer?.store_restrictions)?offer.store_restrictions:[],
        purchase_limit:structured.purchaseLimit,
        offer_notes:structured.notes,
        extraction_confidence:Number(offer?.confidence)||null,
        price_basis_quantity:positive(offer?.price_basis_quantity)??1,
        price_basis_unit:String(offer?.price_basis_unit??"un").trim()||"un",
        image_bbox:offer?.image_box && Number(offer?.image_box_confidence)>=0.8?offer.image_box:null,
        image_bbox_confidence:offer?.image_box && Number(offer?.image_box_confidence)>=0.8?Number(offer.image_box_confidence):null,
        product_id:null,
        match_confidence:0,
        match_type:"unmatched",
        source_page:Math.max(1,Math.trunc(Number(offer?.source_page)||1)),
      };
    }).filter((row:any)=>row!==null);

    if (!rows.length) {
      return json(422,{
        error:"NO_ELIGIBLE_OFFERS",
        message:"Nenhuma oferta elegível sem exigência de meio de pagamento foi encontrada.",
      });
    }

    const {error:itemsError}=await supabase.from("flyer_items").insert(rows);
    if (itemsError) throw itemsError;

    const now=new Date().toISOString();
    await supabase.from("flyer_source_registry").update({
      status:"processed",
      source_title:sourceTitle||title,
      valid_from:validFrom,
      valid_to:validTo,
      last_processed_at:now,
      last_seen_at:now,
      last_error:null,
    }).eq("user_id",job.user_id).eq("file_hash",job.file_hash);

    const url=Deno.env.get("SUPABASE_URL");
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url&&service) {
      EdgeRuntime.waitUntil(fetch(url+"/functions/v1/resolve-flyer-images",{
        method:"POST",
        headers:{authorization:"Bearer "+service,"content-type":"application/json"},
        body:JSON.stringify({flyer_id:flyerId}),
      }).catch(()=>null));
    }

    return json(200,{ok:true,job_id:jobId,flyer_id:flyerId,offers_saved:rows.length,title,valid_from:validFrom,valid_to:validTo});
  } catch(error) {
    console.error("finalize-flyer-job",error);
    return json(500,{error:"FINALIZE_FAILED",message:error instanceof Error?error.message:String(error)});
  }
});