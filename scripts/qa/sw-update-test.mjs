// SW v3 (SPEC-v3 seção 3): (a) 1ª visita já funciona OFFLINE; (b) um aparelho com a v2 instalada recebe a v3 ao reabrir
// (caches da v2 apagados, v3 ativa, app novo carregado, offline depois da atualização).
// Uso: node scripts/qa/sw-update-test.mjs <dist-v2> <dist-v3>
//   dist-v2: build do commit anterior (ex.: git archive <commit> | tar -x -C /tmp/v2src; cd /tmp/v2src; ln -s <repo>/node_modules .; npx vite build)
//   dist-v3: build atual (dist/)
// Serve as duas pastas na MESMA origem (mesmo escopo do SW), trocando a raiz no meio do teste, como um deploy novo.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const [v2, v3] = process.argv.slice(2).map((p) => resolve(p));
if (!v2 || !v3) throw new Error('uso: sw-update-test.mjs <dist-v2> <dist-v3>');
let root = v2;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const srv = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return; }
  const headers = { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': p === '/sw.js' || p === '/index.html' ? 'public, max-age=0, must-revalidate' : 'public, max-age=3600' };
  res.writeHead(200, headers);
  res.end(readFileSync(f));
});
await new Promise((r) => srv.listen(4199, r));
const BASE = 'http://localhost:4199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const cacheInfo = (page) => page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).length; return o; });
const waitCaches = async (page, pred, tries = 80) => { let info; for (let i = 0; i < tries; i++) { info = await cacheInfo(page); if (pred(info)) return info; await sleep(500); } return info; };
const scriptSrc = (page) => page.evaluate(() => (document.querySelector('script[src]') || {}).src || '');
const playRound = async (page) => {
  await page.getByText('ENTRAR').click();
  await page.locator('button.play').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Turbo/ }).first().click().catch(() => {});
  await page.locator('button.play').click();
  for (let i = 0; i < 120; i++) {
    const t = page.getByRole('button', { name: /TERMINAR/ }), c = page.getByRole('button', { name: /CONTINUAR/ }), g = page.getByRole('button', { name: /PEGAR/ });
    if (await t.isVisible().catch(() => false)) await t.click(); else if (await c.isVisible().catch(() => false)) await c.click(); else if (await g.isVisible().catch(() => false)) await g.click();
    else if (await page.locator('button.play').isEnabled().catch(() => false) && (await page.locator('.tr-main .tc.on').count()) === 30) return true;
    await sleep(250);
  }
  return false;
};

// ---------- (a) 1ª visita: offline logo depois ----------
{
  root = v3;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const info = await waitCaches(page, (i) => Object.values(i).some((n) => n > 280));
  out.firstVisit = { caches: info, voiceCached: Object.values(info).some((n) => n > 280) };
  await ctx.setOffline(true);
  const p2 = await ctx.newPage();
  const failed = []; p2.on('requestfailed', (r) => failed.push(r.url())); p2.on('pageerror', (e) => errs.push(String(e)));
  await p2.goto(BASE + '/', { waitUntil: 'load' });
  out.firstVisit.offlineOpens = await p2.getByText('ENTRAR').isVisible();
  out.firstVisit.offlineRound = await playRound(p2);
  out.firstVisit.failedRequests = failed;
  out.firstVisit.errors = errs;
  await ctx.close();
}

// ---------- (b) v2 instalada -> v3 ao reabrir ----------
{
  root = v2;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const before = await waitCaches(page, (i) => Object.values(i).some((n) => n > 280));
  const srcV2 = await scriptSrc(page);
  const sw2 = await page.evaluate(async () => (await (await fetch('/sw.js', { cache: 'no-store' })).text()).match(/const VERSION = '([^']+)'/)?.[1]);
  out.update = { v2Caches: before, v2Script: srcV2, v2SwVersion: sw2 };
  // "deploy" da v3 e reabertura (navegação normal, como abrir o app de novo)
  root = v3;
  await page.goto(BASE + '/');
  const after = await waitCaches(page, (i) => Object.keys(i).some((k) => k.includes('shell-v3')) && !Object.keys(i).some((k) => k.includes('-v2-')) && Object.values(i).some((n) => n > 280), 120);
  out.update.v3Caches = after;
  out.update.v2CachesGone = !Object.keys(after).some((k) => k.includes('-v2-'));
  out.update.v3Script = await scriptSrc(page);
  out.update.pageIsNewBuild = out.update.v3Script !== srcV2;
  await page.reload();
  out.update.controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  out.update.swNow = await page.evaluate(async () => (await (await fetch('/sw.js', { cache: 'no-store' })).text()).match(/const VERSION = '([^']+)'/)?.[1]);
  // voz da v2 foi reaproveitada ou rebaixada? (só informativo)
  await ctx.setOffline(true);
  const p3 = await ctx.newPage();
  const failed = []; p3.on('requestfailed', (r) => failed.push(r.url())); p3.on('pageerror', (e) => errs.push(String(e)));
  await p3.goto(BASE + '/', { waitUntil: 'load' });
  out.update.offlineAfterUpdate = await p3.getByText('ENTRAR').isVisible();
  out.update.offlineRound = await playRound(p3);
  out.update.offlineFailed = failed;
  out.update.errors = errs;
  await ctx.close();
}


console.log(JSON.stringify(out, null, 1));
await browser.close();
srv.close();
const ok = out.firstVisit.offlineOpens && out.firstVisit.offlineRound && out.update.v2CachesGone && out.update.pageIsNewBuild && out.update.offlineAfterUpdate && out.update.offlineRound && !out.firstVisit.errors.length && !out.update.errors.length;
console.log(ok ? 'RESULTADO: OK' : 'RESULTADO: FALHOU');
process.exit(ok ? 0 : 1);
