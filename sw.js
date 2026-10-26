// Service worker: guarda la app completa para usarla sin internet.
const VERSION = 'matias-v15';
const APP = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/vocab.js', './js/speech.js', './js/ui.js',
  './js/special.js', './js/parents.js', './js/log.js', './js/icons.js',
  './js/importer.js',
  './js/search.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await c.addAll(APP.map(u => new Request(u, { cache: 'reload' })));
    // Pictogramas ARASAAC incluidos: se guardan todos para usarlos sin internet
    try {
      const r = await fetch('./pictos/index.json', { cache: 'no-cache' });
      if (r.ok) {
        await c.put('./pictos/index.json', r.clone());
        const ids = Object.keys(await r.json());
        const urls = ids.flatMap(id => [`./pictos/bn/${id}.png`, `./pictos/color/${id}.png`]);
        for (let i = 0; i < urls.length; i += 20) await Promise.allSettled(urls.slice(i, i + 20).map(u => c.add(new Request(u, { cache: 'reload' }))));
      }
    } catch (err) {}
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'arasaac').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Pictogramas ARASAAC: primero la caché, así funcionan sin conexión
  if (url.hostname === 'static.arasaac.org' || (url.hostname === 'api.arasaac.org' && /\/pictograms\/\d+/.test(url.pathname))) {
    e.respondWith(caches.open('arasaac').then(async c => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      const resp = await fetch(req);
      c.put(req.url, resp.clone());
      return resp;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // App: caché primero y actualización en segundo plano
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
    const net = fetch(req).then(resp => { if (resp.ok) c.put(req, resp.clone()); return resp; }).catch(() => null);
    return hit || (await net) || new Response('Sin conexión', { status: 503 });
  }));
});
