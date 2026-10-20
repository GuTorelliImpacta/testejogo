// Teste de resistência (SPEC-v3 3.5.6): N rodadas seguidas no app REAL (build de produção, motor de áudio real),
// CPU 6x (ou CPU=...), medindo a cada 10 rodadas: memória JS (após GC), nós de DOM, listeners (CDP + addEventListener instrumentado),
// timers vivos (setTimeout/setInterval instrumentados), fontes de áudio vivas e estado do AudioContext.
// Prova de estabilidade: as séries depois do aquecimento (rodada 20) não crescem.
//
// Uso: QA_BASE=http://localhost:4181 CPU=6 MODE=turbo ROUNDS=200 npx tsx tests/e2e/perf-endurance.ts [--out=arq.json]
//      MODE=normal ROUNDS=50   (sem Turbo, voz e música reais: ~1 min por rodada)
// Os créditos são mantidos por um save com saldo alto; o presente (créditos infinitos) e ofertas de extra são tratados no laço.
import { chromium, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { BASE, EXE, KEY, baseSave } from './qa/fixtures';

const RATE = Number(process.env.CPU ?? 6);
const MODE = (process.env.MODE ?? 'turbo') as 'turbo' | 'normal';
const ROUNDS = Number(process.env.ROUNDS ?? (MODE === 'turbo' ? 200 : 50));
const EVERY = Number(process.env.EVERY ?? 10);
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);

const PROBE = `
(() => {
  const L = (window.__e = { listeners: 0, timers: new Set(), intervals: new Set(), src: 0, srcLive: 0, nodes: 0 });
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const reg = new WeakMap();
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (f) {
      let m = reg.get(this); if (!m) reg.set(this, (m = new Set()));
      const cap = typeof o === 'object' ? !!(o && o.capture) : !!o;
      const k = t + '|' + cap; const key = f; let s = m.__k || (m.__k = new Map());
      let set = s.get(key); if (!set) s.set(key, (set = new Set()));
      if (!set.has(k)) { set.add(k); L.listeners++; }
    }
    return add.call(this, t, f, o);
  };
  EventTarget.prototype.removeEventListener = function (t, f, o) {
    const m = reg.get(this);
    if (m && m.__k && f) { const set = m.__k.get(f); const cap = typeof o === 'object' ? !!(o && o.capture) : !!o; const k = t + '|' + cap; if (set && set.delete(k)) L.listeners--; }
    return rem.call(this, t, f, o);
  };
  const st = window.setTimeout, ct = window.clearTimeout, si = window.setInterval, ci = window.clearInterval;
  window.setTimeout = function (fn, ms, ...r) { const id = st.call(this, function () { L.timers.delete(id); return typeof fn === 'function' ? fn(...r) : 0; }, ms); L.timers.add(id); return id; };
  window.clearTimeout = function (id) { L.timers.delete(id); return ct.call(this, id); };
  window.setInterval = function (...a) { const id = si.apply(this, a); L.intervals.add(id); return id; };
  window.clearInterval = function (id) { L.intervals.delete(id); return ci.call(this, id); };
  const BAC = window.BaseAudioContext || window.AudioContext;
  if (BAC) for (const m of ['createBufferSource', 'createOscillator']) {
    const o = BAC.prototype[m]; if (!o) continue;
    BAC.prototype[m] = function () { const n = o.apply(this, arguments); L.src++; L.srcLive++; add.call(n, 'ended', () => { L.srcLive--; }); return n; };
  }
  const AC = window.AudioContext; if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ctx = this; } };
})();
`;

interface Sample { round: number; heapMB: number; nodes: number; cdpListeners: number; listeners: number; timers: number; intervals: number; srcLive: number; srcTotal: number; ctx: string }

async function sample(page: Page, cdp: any, round: number): Promise<Sample> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m: Record<string, number> = {};
  for (const x of metrics) m[x.name] = x.value;
  const e = await page.evaluate(() => { const L = (window as any).__e; return { listeners: L.listeners, timers: L.timers.size, intervals: L.intervals.size, srcLive: L.srcLive, src: L.src, ctx: (window as any).__ctx?.state ?? 'n/a' }; });
  return { round, heapMB: Math.round((m.JSHeapUsedSize / 1048576) * 100) / 100, nodes: m.Nodes, cdpListeners: m.JSEventListeners, listeners: e.listeners, timers: e.timers, intervals: e.intervals, srcLive: e.srcLive, srcTotal: e.src, ctx: e.ctx };
}

async function main() {
  const s = baseSave(11);
  s.credits = 900000;
  s.bet = 1;
  s.settings.turbo = MODE === 'turbo';
  s.settings.speed = 'rapida';
  s.settings.light = false;
  s.settings.lightManual = true; // normal (não econômico): o pior caso de DOM/animação
  const browser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.addInitScript(PROBE);
  await ctx.addInitScript(([k, v]: string[]) => { try { if (!sessionStorage.getItem('__s')) { localStorage.setItem(k, v); sessionStorage.setItem('__s', '1'); } } catch { /* */ } }, [KEY, JSON.stringify(s)]);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(BASE + '/');
  await page.getByText('ENTRAR').click();
  await page.locator('button.play').waitFor();
  await page.waitForTimeout(Number(process.env.WARM_MS ?? 40000)); // pré-renderização da música
  if (RATE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  const samples: Sample[] = [await sample(page, cdp, 0)];
  const t0 = Date.now();
  const durations: number[] = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const tr = Date.now();
    await page.locator('button.play').click({ timeout: 60000 });
    // trata oferta / celebração / presente até voltar ao ocioso
    const deadline = Date.now() + 240000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`rodada ${r} não terminou`);
      const term = page.getByRole('button', { name: /TERMINAR/ });
      const cont = page.getByRole('button', { name: /CONTINUAR/ });
      const gift = page.getByRole('button', { name: /PEGAR/ });
      if (await term.isVisible().catch(() => false)) await term.click().catch(() => {});
      else if (await cont.isVisible().catch(() => false)) await cont.click().catch(() => {});
      else if (await gift.isVisible().catch(() => false)) await gift.click().catch(() => {});
      else if (await page.locator('button.play').isEnabled().catch(() => false)) break;
      await page.waitForTimeout(MODE === 'turbo' ? 60 : 250);
    }
    durations.push(Date.now() - tr);
    if (r % EVERY === 0) {
      const sm = await sample(page, cdp, r);
      samples.push(sm);
      console.error(`[${MODE} ${RATE}x] rodada ${r}/${ROUNDS}: heap ${sm.heapMB} MB, nós ${sm.nodes}, listeners ${sm.listeners} (CDP ${sm.cdpListeners}), timers ${sm.timers}+${sm.intervals}, fontes ${sm.srcLive}/${sm.srcTotal}, ctx ${sm.ctx}, ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  }
  const after = samples.filter((x) => x.round >= 20);
  const first = after[0], lastS = after[after.length - 1];
  const verdict = first && lastS ? {
    heapDeltaMB: Math.round((lastS.heapMB - first.heapMB) * 100) / 100,
    nodesDelta: lastS.nodes - first.nodes,
    listenersDelta: lastS.listeners - first.listeners,
    timersDelta: lastS.timers + lastS.intervals - first.timers - first.intervals,
    srcLiveDelta: lastS.srcLive - first.srcLive,
    heapMaxMB: Math.max(...after.map((x) => x.heapMB)),
    nodesMax: Math.max(...after.map((x) => x.nodes)),
  } : null;
  const res = { mode: MODE, rate: RATE, rounds: ROUNDS, medianRoundMs: durations.slice().sort((a, b) => a - b)[Math.floor(durations.length / 2)], samples, verdict, errors: errs };
  if (out) writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, samples: undefined }, null, 1));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
