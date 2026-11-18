// Masal: çevrimdışıyken son görüntülenen sayfa ve veriler gösterilir. Her zaman önce ağ denenir.
const CACHE = 'masal-1.10.0';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'favicon.svg', 'logo-192.png', 'logo-512.png'];

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
  const key = url.origin + url.pathname; // ?t= önbellek kırıcıyı yok say
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return r;
    }).catch(() => caches.match(key).then(m => m || caches.match('index.html')))
  );
});
