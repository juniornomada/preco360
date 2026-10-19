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

function base64url(value) {
 return Buffer.from(JSON.stringify(value)).toString('base64url');
}
const userId='11111111-1111-4111-8111-111111111111';
const fakeJwt=[
 base64url({typ:'JWT',alg:'HS256'}),
 base64url({sub:userId,role:'authenticated',aud:'authenticated',exp:4102444800,iat:1700000000}),
 'non-valid-signature-for-isolated-browser-UI-test'
].join('.');
const session={
 access_token:fakeJwt,
 token_type:'bearer',
 expires_at:4102444800,
 expires_in:100000000,
 refresh_token:'fake-refresh-token-no-real-account',
 user:{
  id:userId,
  aud:'authenticated',
  role:'authenticated',
  email:'synthetic-preview@example.invalid',
  app_metadata:{provider:'email',providers:['email']},
  user_metadata:{},
  created_at:'2024-01-01T00:00:00Z'
 }
};
const key='sb-hwpsnipdkwxvvjowomlo-auth-token';
for(const pathname of ['/search-beta','/search']){
 const context=await browser.newContext({
   viewport:{width:393,height:852},
   userAgent:'Mozilla/5.0 (Linux; Android 13; SM-G780G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
   isMobile:true,hasTouch:true
 });
 await context.addInitScript(({storageKey,stored})=>{
   localStorage.setItem(storageKey,stored);
 },{storageKey:key,stored:JSON.stringify(session)});
 await context.route('**/rest/v1/**',async route=>{
   const headers={'content-type':'application/json','access-control-allow-origin':'*'};
   await route.fulfill({status:200,headers,body:'[]'});
 });
 await context.route('**/auth/v1/**',async route=>{
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:session.user})});
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push('pageerror '+e.message));
 page.on('console',m=>{if(m.type()==='error' && errors.length<15)errors.push(('console '+m.text()).slice(0,240))});
 try{
   const response=await page.goto(origin+pathname,{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForTimeout(5500);
   const text=await page.locator('body').innerText();
   console.log(JSON.stringify({authenticatedSynthetic:true,path:pathname,status:response?.status(),url:page.url(),textLength:text.length,snippet:text.slice(0,500),rootLength:(await page.locator('#root').innerHTML()).length,errors}));
 }catch(e){console.log(JSON.stringify({authenticatedSynthetic:true,path:pathname,error:String(e).slice(0,700),errors}))}
 await context.close();
}
await browser.close();
