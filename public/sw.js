// Service worker do Altina da Sorte: funciona offline desde a primeira visita.
// - App shell (HTML, JS/CSS com hash, ícones) pré-cacheado na instalação.
// - Pacote de voz (manifest.json + clipes) baixado em segundo plano, ainda na instalação.
// - /assets e /audio: cache-first com preenchimento em execução; manifests de voz: rede primeiro.
// BUILD_ID é trocado a cada build (vite.config.ts), então todo deploy gera um SW novo e limpa os caches antigos.
// v3: o cache do app (SHELL) é versionado por build; o pacote de voz (RUNTIME) só muda quando os manifests de voz mudam
// (VOICE_ID), então um deploy novo não rebaixa ~1 MB de voz. Caches de versões anteriores (v2...) são apagados no activate.
// Compatível com Chrome/WebView ~60: sem matchAll, sem sintaxe nova.
const VERSION = 'v3-__BUILD_ID__';
const SHELL = `altina-shell-${VERSION}`;
const RUNTIME = `altina-runtime-v3-__VOICE_ID__`;
const VOICE_DIRS = ['/audio/voice', '/audio/voice-custom'];

async function precacheVoice() {
  const rt = await caches.open(RUNTIME);
  const urls = [];
  for (const dir of VOICE_DIRS) {
    try {
      const res = await fetch(`${dir}/manifest.json`, { cache: 'reload' });
      if (!res.ok || (res.headers.get('content-type') || '').includes('html')) continue;
      await rt.put(`${dir}/manifest.json`, res.clone());
      const m = await res.json();
      const list = Array.isArray(m) ? m : m.ids || m.files || [];
      for (const e of list) {
        if (typeof e !== 'string') continue;
        if (/\.(webm|mp3|ogg|m4a|wav)$/.test(e)) urls.push(`${dir}/${e}`);
        else for (const ext of ['webm', 'mp3']) urls.push(`${dir}/${e}.${ext}`);
      }
    } catch (_) { /* sem pacote de voz: o runtime cuida */ }
  }
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        if (await rt.match(u)) continue; // já está no cache de voz (mesma versão do pacote)
        const r = await fetch(u);
        if (r.ok && !(r.headers.get('content-type') || '').includes('html')) await rt.put(u, r);
      } catch (_) { /* melhor esforço */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(SHELL);
      await c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg']);
      // JS/CSS com hash lidos do HTML atual
      const html = await (await fetch('/', { cache: 'reload' })).text();
      const urls = [];
      const re = /(?:src|href)="(\/assets\/[^"]+)"/g;
      let m;
      while ((m = re.exec(html))) urls.push(m[1]);
      await c.addAll(urls);
      await self.skipWaiting();
      await precacheVoice();
    })(),
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
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/', { ignoreVary: true })),
    );
    return;
  }

  // manifests de voz: rede primeiro (atualizações de clipes), cache se offline
  if (url.pathname.endsWith('/manifest.json')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreVary: true }).then((h) => h || Response.error())),
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
            // voz fica no cache estável; o resto (JS/CSS/ícones) no cache versionado do build
            caches.open(url.pathname.indexOf('/audio/') === 0 ? RUNTIME : SHELL).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
