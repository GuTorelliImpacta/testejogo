// Testa o service worker: offline na 1ª visita, reabertura, cache de voz, atualização com limpeza de caches antigos.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const BASE = 'http://localhost:4173';
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '/');
await page.evaluate(() => navigator.serviceWorker.ready);
// espera o pré-cache de voz terminar
const cacheInfo = () => page.evaluate(async () => {
  const o = {};
  for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).length;
  return o;
});
let info;
for (let i = 0; i < 40; i++) { info = await cacheInfo(); if (Object.values(info).some((n) => n > 280)) break; await sleep(500); }
out.cachesAfterInstall = info;
const rtKey = Object.keys(info).find((k) => k.includes('runtime'));
out.voiceManifestCached = await page.evaluate(async (k) => !!(await (await caches.open(k)).match('/audio/voice/manifest.json')), rtKey);
out.controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
if (!out.controlled) { await page.reload(); out.controlledAfterReload = await page.evaluate(() => !!navigator.serviceWorker.controller); }

// offline: reabrir
await ctx.setOffline(true);
const p2 = await ctx.newPage();
const failed = [];
p2.on('requestfailed', (r) => failed.push(r.url()));
await p2.goto(BASE + '/', { waitUntil: 'load' });
out.offlineReopen = { title: await p2.title(), enterVisible: await p2.getByText('ENTRAR').isVisible() };
await p2.getByText('ENTRAR').click();
await p2.locator('button.play').waitFor({ timeout: 10000 });
await p2.locator('button.play').click();
await sleep(6000);
out.offlineAudioFailed = failed.filter((u) => u.includes('/audio/'));
out.offlineFailedAll = failed;
await p2.close();
await ctx.setOffline(false);
out.errors = errors;

// atualização: muda sw.js (nova versão), simula deploy
const sw = readFileSync('dist/sw.js', 'utf8');
writeFileSync('dist/sw.js', sw.replace(/const VERSION = '[^']+'/, "const VERSION = 'v3-teste'"));
// cria cache "antigo" que deve ser limpo
await page.evaluate(() => caches.open('altina-shell-v1').then((c) => c.put('/x', new Response('x'))));
await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
for (let i = 0; i < 40; i++) { info = await cacheInfo(); if (info['altina-shell-v3-teste'] && Object.values(info).some((n) => n > 280)) break; await sleep(500); }
for (let i = 0; i < 20; i++) { info = await cacheInfo(); if (!info['altina-shell-v1']) break; await sleep(500); }
out.cachesAfterUpdate = await cacheInfo();
// app continua funcionando offline depois da atualização
await ctx.setOffline(true);
const p3 = await ctx.newPage();
await p3.goto(BASE + '/');
out.offlineAfterUpdate = await p3.getByText('ENTRAR').isVisible();
await ctx.setOffline(false);
writeFileSync('dist/sw.js', sw);
await browser.close();
console.log(JSON.stringify(out, null, 1));
