const CACHE="smartpos-pro-default-v8";
const ASSETS=["./","./index.html","./styles.css","./app.js","./drive.js","./icon.svg","./manifest.webmanifest","./vendor/JsBarcode.all.min.js","./vendor/html5-qrcode.min.js"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("smartpos-pro-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 const req=e.request,url=new URL(req.url);
 if(req.method!=="GET"||url.origin!==self.location.origin||url.pathname.includes("/preview-mobile/"))return;
 const scope=new URL(self.registration.scope);
 if(!url.pathname.startsWith(scope.pathname))return;
 const rel=url.pathname.slice(scope.pathname.length);
 if(rel.includes("/"))return;
 const shell=req.mode==="navigate"||["","index.html","app.js","styles.css"].includes(rel);
 if(shell){
  e.respondWith(fetch(req).then(res=>{
   if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy))}
   return res;
  }).catch(async()=>{
   const cache=await caches.open(CACHE);
   return await cache.match(req)||await cache.match(rel==="app.js"?"./app.js":rel==="styles.css"?"./styles.css":"./index.html")||Response.error();
  }));
  return;
 }
 e.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{
  if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy))}
  return res;
 }).catch(()=>Response.error())));
});