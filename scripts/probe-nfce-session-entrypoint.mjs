// Non-sensitive read-only probe: form entry point with no real fiscal keys.
const url="https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx";
async function one(redirect,mobile=false) {
 const response=await fetch(url,{redirect,signal:AbortSignal.timeout(12000),headers:{"Accept":"text/html,application/xhtml+xml","Accept-Language":"pt-BR,pt;q=0.9", ...(mobile?{"User-Agent":"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36"}:{})}});
 const text=await response.text();
 const fields=[...text.matchAll(/<input\b[^>]*type=["']hidden["'][^>]*>/gi)].map(m=>m[0].match(/\bname=["']([^"']+)["']/i)?.[1]).filter(Boolean);
 const title=text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]??"";
 console.log(JSON.stringify({redirect,mobile,hasParsedViewstate:fields.includes('__VIEWSTATE'),hiddenCount:fields.length,status:response.status,finalPath:new URL(response.url).pathname,locationPath:response.headers.get("location")?new URL(response.headers.get("location"),url).pathname:null,length:text.length,title,hasViewstate:/__VIEWSTATE/i.test(text),rejected:/Request Rejected|The requested URL was rejected/i.test(text),contentType:response.headers.get("content-type")}));
}
for(const mode of ["manual","follow"])try{await one(mode)}catch(e){console.log(JSON.stringify({mode,error:String(e).slice(0,170)}))}

try { await one("manual",true); }catch(e){console.log(JSON.stringify({mode:"mobile",error:String(e).slice(0,170)}));}

const qrUrl="https://www.nfce.fazenda.sp.gov.br/qrcode?p=invalid-probe-only";
for (const mobile of [false,true]) {
 try {
  const res=await fetch(qrUrl,{signal:AbortSignal.timeout(12000),redirect:"follow",headers:{"Accept":"text/html,application/xhtml+xml","Accept-Language":"pt-BR,pt;q=0.9",...(mobile?{"User-Agent":"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36"}:{})}});
  const html=await res.text();
  console.log(JSON.stringify({qrProbe:true,mobile,status:res.status,path:new URL(res.url).pathname,htmlLength:html.length,viewstate:/__VIEWSTATE/i.test(html),rejected:/Request Rejected|The requested URL was rejected/i.test(html),title:html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim().slice(0,90)??""}));
 }catch(e){console.log(JSON.stringify({qrProbe:true,mobile,error:String(e).slice(0,150)}))}
}
