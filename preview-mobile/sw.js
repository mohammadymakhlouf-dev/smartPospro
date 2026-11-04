const CACHE="smartpos-mobile-preview-v9";
const ASSETS=["./","./index.html","./styles.css","./app.js","./drive.js","./icon.svg","./manifest.webmanifest","./vendor/JsBarcode.all.min.js","./vendor/html5-qrcode.min.js"];
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("smartpos-mobile-preview-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
 const request=event.request;
 const url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin||!url.pathname.includes("/preview-mobile/"))return;
 const isShell=request.mode==="navigate"||/\/(?:index\.html|app\.js|styles\.css)$/.test(url.pathname);
 if(isShell){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}
   return response;
  }).catch(async()=>{
   const cache=await caches.open(CACHE);
   return await cache.match(request)||await cache.match(url.pathname.split("/").pop()==="app.js"?"./app.js":url.pathname.split("/").pop()==="styles.css"?"./styles.css":"./index.html")||Response.error();
  }));
  return;
 }
 event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
  if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}
  return response;
 }).catch(()=>Response.error())));
});