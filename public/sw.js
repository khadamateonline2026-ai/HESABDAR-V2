const CACHE = "hesabdar-shell-v2";
const PRECACHE = ["/", "/hesabdar.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.includes("change-password") ||
    url.pathname.includes("reset-password") ||
    url.pathname.includes("sign-up") ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }
  event.respondWith(networkThenCache(req));
});

async function networkThenCache(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) await cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const hit = (await cache.match(req)) || (req.mode === "navigate" ? await cache.match("/") : undefined);
    if (hit) return hit;
    return new Response(
      "<!doctype html><html lang=fa dir=rtl><body style='font-family:sans-serif;padding:2rem'><h1>آفلاین هستید</h1><p>اتصال اینترنت برقرار نیست. پس از وصل شدن صفحه را تازه کنید.</p></body></html>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}
