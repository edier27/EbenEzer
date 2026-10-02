'use strict';
// Service worker: permite abrir la tienda sin internet.
// Estrategia "red primero": siempre que hay conexión se usa la versión
// más nueva de los archivos; sin conexión se usa la última guardada.
const CACHE = 'tienda-v2';
const ARCHIVOS = ['./', 'index.html', 'css/app.css', 'manifest.json', 'icon.svg', 'version.json',
  'js/core.js', 'js/db.js', 'js/reglas.js', 'js/neg.js', 'js/ia.js', 'js/sync.js', 'js/app.js',
  'js/vistas/vender.js', 'js/vistas/inventario.js', 'js/vistas/gestion.js', 'js/vistas/reportes.js', 'js/vistas/config.js'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
