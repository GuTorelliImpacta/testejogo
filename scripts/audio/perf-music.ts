// @ts-nocheck  (script Node)
/**
 * Mede o custo da música no Chromium real (Playwright + CDP): `npx tsx scripts/audio/perf-music.ts [raiz-src] [segundos] [economia]`
 *  - raiz-src: pasta que contém audio/ (padrão: src). Use uma cópia do commit anterior para o "antes".
 *  - mede: Performance.getMetrics (TaskDuration/ScriptDuration da thread principal), CPU de TODOS os processos do
 *    navegador (SystemInfo.getProcessInfo, inclui a thread de áudio), nós Web Audio criados por segundo e
 *    callbacks de setTimeout por segundo.
 * Saída: JSON em stdout.
 */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(process.argv[2] ?? 'src');
const secs = Number(process.argv[3] ?? 30);
const eco = process.argv[4] === 'eco';
const none = process.argv[4] === 'none'; // linha de base: contexto aberto, sem música
const exe = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p) => p && existsSync(p));
if (!exe) throw new Error('Chromium não encontrado (CHROMIUM_PATH)');

const dir = mkdtempSync(join(tmpdir(), 'perfmusic-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
  entry,
  `import { AudioEngine } from '${root}/audio/engine';
import { Music } from '${root}/audio/music';
(window as any).__counts = { nodes: 0, timeouts: 0, long: 0, maxTask: 0 };
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { (window as any).__counts.long++; ((window as any).__lt ||= []).push([Math.round(e.startTime), Math.round(e.duration)]); (window as any).__counts.maxTask = Math.max((window as any).__counts.maxTask, e.duration); } }).observe({ entryTypes: ['longtask'] }); } catch {}
const C = (window as any).__counts;
for (const k of ['createOscillator','createGain','createBiquadFilter','createBufferSource']) {
  const o = (BaseAudioContext.prototype as any)[k];
  (BaseAudioContext.prototype as any)[k] = function (...a) { C.nodes++; return o.apply(this, a); };
}
const st = window.setTimeout.bind(window);
(window as any).setTimeout = (fn, ms, ...r) => st((...a) => { C.timeouts++; return fn(...a); }, ms, ...r);
(window as any).__start = async (eco) => {
  const e = new AudioEngine();
  await e.unlock();
  const m: any = new Music(e);
  if (eco && m.setEconomy) m.setEconomy(true);
  const t0 = performance.now();
  if (!(window as any).__none) m.start('calm');
  let first = 0;
  if (m.whenReady && !(window as any).__none) {
    await m.whenReady();
    first = Math.round(performance.now() - t0);
    await m.whenReady(true);
  }
  (window as any).__music = m;
  return { firstLoopsMs: first, ready: Math.round(performance.now() - t0), sr: e.ctx.sampleRate, state: e.ctx.state, mem: m.memoryBytes ?? 0, pre: m.prerendered ?? false };
};
`,
);
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', target: 'es2020', logLevel: 'error' });

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
await page.addScriptTag({ content: out.outputFiles[0].text });
const cdp = await page.context().newCDPSession(page);
const bcdp = await browser.newBrowserCDPSession();
await cdp.send('Performance.enable');
const throttle = Number(process.env.THROTTLE ?? 1);
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const cpu = async () => {
  try {
    const r = await bcdp.send('SystemInfo.getProcessInfo');
    return r.processInfo.reduce((a, p) => a + p.cpuTime, 0);
  } catch {
    return NaN;
  }
};
const c = () => page.evaluate(() => ({ ...(window as any).__counts }));

const cpuA = await cpu();
const mA = await metrics();
const cA = await c();
await page.evaluate((n) => ((window as any).__none = n), none);
const startInfo = await page.evaluate((e) => (window as any).__start(e), eco);
const cpuB = await cpu();
const mB = await metrics();
const cB = await c();
await page.waitForTimeout(secs * 1000);
const cpuC = await cpu();
const mC = await metrics();
const cC = await c();
console.error('tarefas longas (início ms, duração ms):', JSON.stringify((await page.evaluate(() => (window as any).__lt)) ?? []));
const state = await page.evaluate(() => (window as any).__music && true);
const r = (x) => +x.toFixed(3);
console.log(
  JSON.stringify(
    {
      root,
      secs,
      throttle,
      longTasks: cC.long,
      maxTaskMs: Math.round(cC.maxTask),
      eco,
      startInfo,
      prep: { readyMs: startInfo.ready, mainTaskS: r(mB.TaskDuration - mA.TaskDuration), scriptS: r(mB.ScriptDuration - mA.ScriptDuration), allProcCpuS: r(cpuB - cpuA), nodes: cB.nodes - cA.nodes },
      steady: {
        mainTaskS: r(mC.TaskDuration - mB.TaskDuration),
        scriptS: r(mC.ScriptDuration - mB.ScriptDuration),
        allProcCpuS: r(cpuC - cpuB),
        nodesPerSec: r((cC.nodes - cB.nodes) / secs),
        timeoutsPerSec: r((cC.timeouts - cB.timeouts) / secs),
      },
      alive: state,
    },
    null,
    1,
  ),
);
await browser.close();
