const CACHE="smartpos-mobile-preview-v3";
const ASSETS=["./","./index.html","./styles.css","./app.js","./drive.js","./icon.svg","./manifest.webmanifest","./vendor/JsBarcode.all.min.js","./vendor/html5-qrcode.min.js"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x.startsWith("smartpos-mobile-preview-")&&x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=="GET"||u.origin!==self.location.origin||!u.pathname.includes("/preview-mobile/"))return;
 e.respondWith(caches.match(r).then(cached=>cached||fetch(r).then(response=>{
  if(response.ok&&response.type==="basic"){const copy=response.clone();caches.open(CACHE).then(c=>c.put(r,copy))}
  return response;
 }).catch(()=>r.mode==="navigate"?caches.match("./index.html"):Response.error())));
});
