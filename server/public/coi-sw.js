// Ayudante de la página: GitHub Pages no deja poner las cabeceras que permiten usar todos los núcleos del
// procesador (aislamiento de origen). Este «service worker» las agrega a la página, y así el detector YOLO
// corre en varios hilos (unas 3 a 6 veces más rápido sin tarjeta gráfica).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  // Solo esta página (camara.html) necesita las cabeceras; lo demás pasa directo.
  if (r.mode !== 'navigate' || !/\/camara\.html$/.test(new URL(r.url).pathname)) return;
  e.respondWith(
    fetch(r).then((res) => {
      if (!res.ok && res.status !== 0) return res;
      const h = new Headers(res.headers);
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      // «credentialless»: las imágenes del mapa y los scripts de otros sitios cargan igual (sin cookies).
      h.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }).catch(() => fetch(r)),
  );
});
