// Masal: sürüm numaralı dosyalar önbellekten anında, sayfa önce ağdan (yavaşsa önbellekten) gelir; çevrimdışıyken son kopya açılır.
const CACHE = 'masal-1.70.0';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'favicon.svg', 'logo-192.png', 'logo-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // OKX ve GitHub isteklerine dokunma
  // Sürüm numaralı dosyalar (app.js?v=…, en.json?v=…) ve simgeler değişmez: önbellekten anında gelir
  if (url.searchParams.has('v') || /\.(png|svg)$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request.url).then(m => m || fetch(e.request).then(r => {
      if (r.ok) c.put(e.request.url, r.clone());
      return r;
    }))));
    return;
  }
  const key = url.origin + url.pathname; // ?t= önbellek kırıcıyı yok say
  // Sayfa önce ağdan (her zaman en yeni sürüm); ağ 3 sn'de cevap vermezse kayıtlı kopya açılır
  const net = fetch(e.request, {cache: 'no-cache'}).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return r;
  });
  const slow = new Promise(res => setTimeout(() => caches.match(key).then(m => m && res(m)), 3000));
  e.respondWith(Promise.race([net.catch(() => caches.match(key).then(m => m || caches.match('index.html'))), slow]));
});
