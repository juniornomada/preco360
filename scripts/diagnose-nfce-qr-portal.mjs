// Public endpoint probe with deliberately invalid QR parameter.
const origins=[
  'https://www.nfce.fazenda.sp.gov.br/qrcode?p=invalid-probe-only',
  'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=invalid-probe-only',
  'https://www.nfce.fazenda.sp.gov.br/qrcode'
];
for(const url of origins){
 try{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  const response=await fetch(url,{redirect:'follow',signal:controller.signal,
    headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
      'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language':'pt-BR,pt;q=0.9'}});
  clearTimeout(timeout);
  const html=await response.text();
  const sanitized=html.slice(0,1200).replace(/p=[^"'&\s<]+/g,'p=[redacted]');
  console.log(JSON.stringify({url: new URL(url).pathname,status:response.status,finalPath:new URL(response.url).pathname,
    bytes:html.length, contentType:response.headers.get('content-type'),
    hasItems:/txtTit|RvlUnit|\(C[oó]digo\s*:\s*/i.test(html),
    prefix:sanitized}));
 }catch(e){console.log(JSON.stringify({url:new URL(url).pathname,error:String(e).slice(0,240)}))}
}
