// Service worker mínimo: permite instalar la app en el móvil.
// No guarda datos en caché: siempre se usa la versión del servidor.
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () {});
