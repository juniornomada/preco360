import { chromium } from '@playwright/test';

const origin='https://preco360.vercel.app';
const routes=['/search','/search-beta','/'];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
for(const pathname of routes){
 const context=await browser.newContext({
    viewport:{width:393,height:852},
    userAgent:'Mozilla/5.0 (Linux; Android 13; SM-G780G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    isMobile:true,hasTouch:true,
    ignoreHTTPSErrors:false
 });
 const page=await context.newPage();
 const exceptions=[],requests=[];
 page.on('pageerror',e=>exceptions.push(('pageerror: '+e.message).slice(0,400)));
 page.on('console',msg=>{if(msg.type()==='error')exceptions.push(('console: '+msg.text()).slice(0,400))});
 page.on('requestfailed',req=>{if(requests.length<20)requests.push(req.method()+' '+new URL(req.url()).pathname+' '+String(req.failure()?.errorText??'').slice(0,180))});
 page.on('response',res=>{if(res.status()>=400 && requests.length<20) requests.push('HTTP '+res.status()+' '+new URL(res.url()).pathname)});
 try{
    const response=await page.goto(origin+pathname,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(6500);
    const visible=await page.locator('body').innerText({timeout:5000}).catch(()=>'<cannot read body>');
    const html=await page.locator('#root').innerHTML().catch(()=>'<no #root>');
    const report={
      route:pathname,
      status:response?.status(),
      location:page.url(),
      title:await page.title(),
      textLength:visible.length,
      snippet:visible.slice(0,220),
      rootHTMLLength:html.length,
      hasRoot:await page.locator('#root').count(),
      exceptions, requests
    };
    console.log(JSON.stringify(report));
 }catch(e){console.log(JSON.stringify({route:pathname,fatal:String(e).slice(0,500),exceptions,requests}))}
 await context.close();
}
await browser.close();
