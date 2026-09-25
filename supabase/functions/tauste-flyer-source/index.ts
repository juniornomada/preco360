import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ACCOUNT_ID = "9D99E5AF8D6";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function json(status:number, body:unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type":"application/json" },
  });
}

function normalize(value:unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async(req:Request)=>{
  if (req.method!=="POST") return json(405,{error:"METHOD_NOT_ALLOWED"});

  const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer=(req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i,"");
  if (!serviceRole || bearer!==serviceRole) return json(401,{error:"UNAUTHORIZED"});

  try {
    const body=await req.json().catch(()=>({}));
    const collectionHash=String(body?.collection_hash ?? "").trim();
    const sourceUrl=String(body?.source_url ?? "").trim();
    if (!collectionHash || !/^[a-z0-9_-]{8,}$/i.test(collectionHash)) {
      return json(400,{error:"COLLECTION_HASH_REQUIRED"});
    }
    if (!sourceUrl || !/^https:\/\/www\.flipsnack\.com\/taustesupermercado\//i.test(sourceUrl)) {
      return json(400,{error:"SOURCE_URL_INVALID"});
    }

    const token=btoa(ACCOUNT_ID+"+"+collectionHash);
    const authorization=new URL("https://content-private.flipsnack.com/authorization");
    authorization.searchParams.set("hash",token);
    authorization.searchParams.set("domain","www.flipsnack.com");

    const authorizationResponse=await fetch(authorization,{
      headers:{
        "user-agent":BROWSER_UA,
        "accept":"application/json,*/*",
        "referer":sourceUrl,
        "origin":"https://player.flipsnack.com",
      },
    });
    if (!authorizationResponse.ok) {
      throw new Error("AUTH_HTTP_"+authorizationResponse.status);
    }

    const authorizationData=await authorizationResponse.json();
    const signature=String(
      authorizationData?.signature?.[collectionHash] ?? "",
    );
    if (!signature) throw new Error("AUTH_SIGNATURE_MISSING");

    const dataUrl=
      "https://d3u72tnj701eui.cloudfront.net/"+ACCOUNT_ID+
      "/collections/"+collectionHash+"/data.json?"+signature;

    const dataResponse=await fetch(dataUrl,{
      headers:{
        "user-agent":BROWSER_UA,
        "accept":"application/json,*/*",
        "referer":"https://player.flipsnack.com/",
      },
    });
    if (!dataResponse.ok) {
      throw new Error("DATA_HTTP_"+dataResponse.status);
    }

    const data=await dataResponse.json();
    const title=String(data?.properties?.title ?? "").trim();
    if (!normalize(title).includes("marilia")) {
      throw new Error("PUBLICATION_NOT_MARILIA");
    }

    const order=Array.isArray(data?.pages?.order)
      ? data.pages.order.flat()
      : [];
    const pages=order
      .map((pageId:unknown,index:number)=>{
        const id=String(pageId ?? "").trim();
        if (!id) return null;
        const page=data?.pages?.data?.[id] ?? {};
        const coverVersion=Number(page?.coverVersion) || 1;
        return {
          id,
          position:index+1,
          url:
            "https://d3u72tnj701eui.cloudfront.net/"+ACCOUNT_ID+
            "/collections/"+collectionHash+"/covers/"+encodeURIComponent(id)+
            "/original?"+signature+"&v="+coverVersion,
          type:String(page?.type ?? "jpg"),
          width:Number(page?.width) || null,
          height:Number(page?.height) || null,
        };
      })
      .filter(Boolean);

    if (!pages.length) throw new Error("PUBLICATION_WITHOUT_PAGES");

    return json(200,{
      collection_hash:collectionHash,
      title:title || "Ofertas Tauste Marília",
      source_url:sourceUrl,
      updated_at:Number(data?.properties?.dateLastUpdate) || null,
      page_count:pages.length,
      pages,
    });
  } catch(error) {
    console.error("tauste-flyer-source",error);
    return json(502,{error:error instanceof Error ? error.message : String(error)});
  }
});
