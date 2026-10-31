// Offline shell: the app opens instantly even with a weak connection. Data always comes live from Supabase.
const CACHE = "jarvis-v3";
const SHELL = ["./", "index.html", "style.css?v=3", "app.js?v=3", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;                 // never cache API calls
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; })
    .catch(() => caches.match(e.request)));
});
