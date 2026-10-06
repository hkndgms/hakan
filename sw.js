// Giriş sayfasının dosyalarını saklar; böylece sayfa internetsiz de açılır ve uygulama olarak kurulabilir.
// Sadece bu sitenin kendi dosyalarına dokunur. GitHub isteklerine ve verilere karışmaz.
// Önce ağdan dener (güncel sürüm), ağ yoksa saklananı verir.
const SURUM = "giris-v2";
const DOSYALAR = ["./", "index.html", "giris.js", "giris-cekirdek.js", "stil.css", "manifest.webmanifest", "ikon-192.png", "ikon-512.png"];

self.addEventListener("install", (olay) => {
  olay.waitUntil(caches.open(SURUM).then((c) => c.addAll(DOSYALAR)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (olay) => {
  olay.waitUntil(caches.keys()
    .then((adlar) => Promise.all(adlar.filter((a) => a !== SURUM).map((a) => caches.delete(a))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (olay) => {
  const istek = olay.request;
  if (istek.method !== "GET" || new URL(istek.url).origin !== self.location.origin) return;
  olay.respondWith((async () => {
    const onbellek = await caches.open(SURUM);
    try {
      const yanit = await fetch(istek, { cache: "no-cache" });
      if (yanit.ok) await onbellek.put(istek, yanit.clone());
      return yanit;
    } catch {
      return (await onbellek.match(istek, { ignoreSearch: true })) ?? (istek.mode === "navigate" ? onbellek.match("index.html") : Response.error());
    }
  })());
});
