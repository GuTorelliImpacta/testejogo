// Service worker do Altina da Sorte: funciona offline.
// Estratégia: app shell pré-cacheado; /assets e /audio em cache-first com preenchimento em execução.
const VERSION = 'v2';
const SHELL = `altina-shell-${VERSION}`;
const RUNTIME = `altina-runtime-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then(async (c) => {
        await c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon.svg']);
        // pré-cacheia os JS/CSS do app (nomes com hash) lidos do HTML
        const html = await (await fetch('/', { cache: 'reload' })).text();
        const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
        await c.addAll(urls);
        // pacote de voz: baixa em segundo plano (melhor esforço; não falha a instalação)
        try {
          const m = await (await fetch('/audio/voice/manifest.json')).json();
          await c.put('/audio/voice/manifest.json', await fetch('/audio/voice/manifest.json'));
          const rt = await caches.open(RUNTIME);
          for (const id of m.ids || []) {
            for (const ext of ['webm', 'mp3']) {
              const u = `/audio/voice/${id}.${ext}`;
              try { const r = await fetch(u); if (r.ok) await rt.put(u, r); } catch (e) { /* ignora */ }
            }
          }
        } catch (e) { /* sem voz pré-baixada: o runtime cuida */ }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/', { ignoreVary: true })),
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
