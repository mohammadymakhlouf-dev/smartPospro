const CACHE = "smartpos-blue-full-preview-1";
const ASSETS = ["./", "./index.html", "./app.js", "./styles.css", "./drive.js", "./manifest.webmanifest"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (!url.pathname.includes("/blue-full-preview/")) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
