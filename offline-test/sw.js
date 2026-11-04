const VERSION="smartpos-offline-pos-lab-v4";
const BASE=new URL("./",self.location.href);
const FILES=["./","./index.html","./styles.css","./app.js","./drive-demo.js","./enhance.js","./manifest.webmanifest","./icon.svg"].map(x=>new URL(x,BASE).href);
const LIB="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
const BARLIB="https://unpkg.com/jsbarcode@3.12.1/dist/JsBarcode.all.min.js";
self.addEventListener("install",e=>{
 e.waitUntil((async()=>{
  const c=await caches.open(VERSION);
  await c.addAll(FILES);
  for(const url of [LIB,BARLIB]){try{const res=await fetch(url,{mode:"no-cors",cache:"reload"});await c.put(url,res);}catch(e){console.warn("library not yet cached",url,e);}}
  await self.skipWaiting();
 })());
});
self.addEventListener("activate",e=>{
 e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith("smartpos-offline-pos-lab-")&&k!==VERSION).map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener("message",e=>{
 if(e.data?.type!=="CHECK_READY")return;
 e.waitUntil((async()=>{
  const c=await caches.open(VERSION);
  const cached=await Promise.all([...FILES,LIB,BARLIB].map(x=>c.match(x)));
  e.ports?.[0]?.postMessage({ready:cached.every(Boolean)});
 })());
});
self.addEventListener("fetch",e=>{
 const r=e.request;if(r.method!=="GET")return;
 const url=new URL(r.url);
 const isLocal=url.origin===self.location.origin&&url.pathname.startsWith(BASE.pathname);
 const isLibrary=r.url===LIB||r.url===BARLIB;
 if(!isLocal&&!isLibrary)return;
 e.respondWith((async()=>{
  const cache=await caches.open(VERSION);
  const hit=await cache.match(r);
  if(hit)return hit;
  try{
   const response=await fetch(r);
   if(response.ok||response.type==="opaque")cache.put(r,response.clone()).catch(()=>{});
   return response;
  }catch(err){
   if(r.mode==="navigate")return (await cache.match(new URL("./index.html",BASE).href))||Response.error();
   return Response.error();
  }
 })());
});