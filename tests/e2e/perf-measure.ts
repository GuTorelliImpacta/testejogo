// Medição de desempenho por cena (SPEC-v3 3.5.3 / 3.5.7): tarefa mais longa, FPS, quadro mais lento, INP, memória, DOM.
// Playwright + Chromium local (nunca `playwright install`), CPU lento via CDP `Emulation.setCPUThrottlingRate`
// e trace de performance (RunTask da thread principal) + PerformanceObserver (longtask, event timing) + rAF.
//
// Uso: QA_BASE=http://localhost:4181 CPU=6 npx tsx tests/e2e/perf-measure.ts [ctx,...] [--out=arquivo.json]
//   ctx: livre (painel, sorteio sem Turbo, Turbo direto, INP de JOGAR), marcas (Turbo com ~30 células),
//        bingo (comemoração), extra (oferta + INP de BOLA EXTRA), enter (12 s depois do ENTRAR, pré-render do áudio)
// A pré-renderização da música (3.5.4) roda ~30 s depois do ENTRAR: as cenas só são medidas depois disso (CPU livre até lá).
import { chromium, type Page, type CDPSession } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { BASE, EXE, KEY, baseSave, fillers, mkPlan, nearBingo, nearDouble, withRound } from './qa/fixtures';
import type { SaveData } from '../../src/types';

const RATE = Number(process.env.CPU ?? 6);
const MODE = process.env.MODE ?? 'normal'; // normal: simula tablet "bom" (8 núcleos, sem modo econômico automático); eco: 2 núcleos (liga o modo econômico)
const NOAUDIO = !!process.env.NOAUDIO; // sem Web Audio: isola o custo de DOM/CSS e testa o fallback sem áudio
const WARM_MS = Number(process.env.WARM_MS ?? (NOAUDIO ? 500 : 38000));
const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith('--out='))?.slice(6);
const names = (args.filter((a) => !a.startsWith('--'))[0] ?? 'enter,livre,marcas,bingo,extra').split(',');

const PROBE = `
(() => {
  const P = (window.__p = { frames: [], run: false, last: 0, long: [], ev: [] });
  const loop = (t) => { if (P.run) { if (P.last) P.frames.push(t - P.last); P.last = t; } else P.last = 0; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push({ s: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.ev.push({ n: e.name, d: e.duration, s: e.startTime, id: e.interactionId || 0 }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) {}
})();
`;

interface Task { dur: number; ts: number; top: Record<string, number> }
export interface SceneResult {
  scene: string;
  windowMs: number;
  maxTaskMs: number;
  tasksOver50: number;
  tasksOver100: number;
  top3: { ms: number; parts: string }[];
  fps: number;
  frames: number;
  worstFrameMs: number;
  framesOver100: number;
  inpMs: number | null;
  extra?: Record<string, number | string>;
}

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o: Record<string, number> = {};
  for (const m of metrics) o[m.name] = m.value;
  return o;
}

/** Interpreta o trace: tarefas RunTask da thread principal do renderizador, com decomposição das mais longas. */
function parseTrace(buf: Buffer): Task[] {
  const json = JSON.parse(buf.toString());
  const evs: any[] = json.traceEvents ?? json;
  const mainTids = new Set<string>();
  for (const e of evs) if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain') mainTids.add(`${e.pid}:${e.tid}`);
  const onMain = evs.filter((e) => e.ph === 'X' && mainTids.has(`${e.pid}:${e.tid}`));
  const tasks = onMain.filter((e) => e.name === 'RunTask').sort((a, b) => a.ts - b.ts);
  const kids = onMain.filter((e) => e.name !== 'RunTask').sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const out: Task[] = [];
  let ki = 0;
  for (const t of tasks) {
    const top: Record<string, number> = {};
    while (ki < kids.length && kids[ki].ts < t.ts) ki++;
    if (t.dur >= 20000) {
      // tempo exclusivo por nome (pilha de eventos aninhados); GC e seus filhos contam como "GC"
      const stack: { end: number; name: string; self: number }[] = [];
      const flush = (upTo: number) => {
        while (stack.length && stack[stack.length - 1].end <= upTo) {
          const f = stack.pop()!;
          top[f.name] = (top[f.name] ?? 0) + f.self / 1000;
        }
      };
      for (let j = ki; j < kids.length && kids[j].ts < t.ts + t.dur; j++) {
        const k = kids[j];
        flush(k.ts);
        const gc = /GC$|^V8\.GC/.test(k.name);
        if (stack.length && /GC$/.test(stack[stack.length - 1].name)) continue; // dentro de um GC
        if (stack.length) stack[stack.length - 1].self -= k.dur;
        stack.push({ end: k.ts + k.dur, name: gc ? 'GC' : k.name, self: k.dur });
      }
      flush(Infinity);
      const acc = Object.values(top).reduce((a, b) => a + b, 0);
      if (t.dur / 1000 - acc > 1) top['(sem rótulo/nativo)'] = t.dur / 1000 - acc;
    }
    out.push({ dur: t.dur / 1000, ts: t.ts, top });
  }
  return out;
}

async function sceneWindow(page: Page, cdp: CDPSession, label: string, action: () => Promise<void>, settleMs: number, extra?: () => Promise<Record<string, number | string>>): Promise<SceneResult> {
  await page.evaluate(() => { const p = (window as any).__p; p.frames = []; p.long = []; p.ev = []; p.run = true; p.last = 0; });
  if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  await (page.context().browser() as any).startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'v8', ...(process.env.INVAL ? ['disabled-by-default-devtools.timeline.invalidationTracking'] : [])] });
  const t0 = Date.now();
  await action();
  await page.waitForTimeout(settleMs);
  const buf: Buffer = await (page.context().browser() as any).stopTracing();
  const windowMs = Date.now() - t0;
  if (process.env.PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map<string, number>();
    const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
    const dts: number[] = profile.timeDeltas ?? [];
    (profile.samples ?? []).forEach((sid: number, i: number) => {
      const n: any = byId.get(sid);
      const k = `${n.callFrame.functionName || '(anon)'} ${String(n.callFrame.url).split('/').pop()}:${n.callFrame.lineNumber}`;
      self.set(k, (self.get(k) ?? 0) + (dts[i] ?? 0) / 1000);
    });
    const parent = new Map<number, number>();
    for (const n of profile.nodes as any[]) for (const c of n.children ?? []) parent.set(c, n.id);
    const incl = new Map<string, number>();
    (profile.samples ?? []).forEach((sid: number, i: number) => {
      const seen = new Set<string>();
      for (let id: number | undefined = sid; id !== undefined; id = parent.get(id)) {
        const n: any = byId.get(id);
        if (!String(n.callFrame.url).includes('index-')) continue;
        const k = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber}`;
        if (seen.has(k)) continue;
        seen.add(k);
        incl.set(k, (incl.get(k) ?? 0) + (dts[i] ?? 0) / 1000);
      }
    });
    console.error(`  inclusivo ${label}: ` + [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${Math.round(v)}ms`).join(' | '));
    console.error(`  perfil ${label}: ` + [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${Math.round(v)}ms`).join(' | '));
  }
  if (process.env.TRACE_DUMP) writeFileSync(process.env.TRACE_DUMP + '-' + label.replace(/\W+/g, '_') + '.json', buf);
  const p = await page.evaluate(() => { const p = (window as any).__p; p.run = false; return { frames: p.frames as number[], ev: p.ev as { n: string; d: number; id: number }[] }; });
  const tasks = parseTrace(buf).sort((a, b) => b.dur - a.dur);
  const fr = p.frames;
  const sum = fr.reduce((a, b) => a + b, 0);
  const inpEv = p.ev.filter((e) => e.id > 0 && /^(click|pointerup|pointerdown|keydown)$/.test(e.n));
  const res: SceneResult = {
    scene: label,
    windowMs,
    maxTaskMs: Math.round((tasks[0]?.dur ?? 0) * 10) / 10,
    tasksOver50: tasks.filter((t) => t.dur > 50).length,
    tasksOver100: tasks.filter((t) => t.dur > 100).length,
    top3: tasks.slice(0, 3).map((t) => ({ ms: Math.round(t.dur), parts: Object.entries(t.top).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') })),
    fps: fr.length ? Math.round((fr.length / (sum / 1000)) * 10) / 10 : 0,
    frames: fr.length,
    worstFrameMs: Math.round(Math.max(0, ...fr)),
    framesOver100: fr.filter((f) => f > 100).length,
    inpMs: inpEv.length ? Math.max(...inpEv.map((e) => e.d)) : null,
  };
  if (extra) res.extra = await extra();
  return res;
}

async function mem(page: Page, cdp: CDPSession) {
  const m = await metrics(cdp);
  return { jsHeapMB: Math.round((m.JSHeapUsedSize / 1048576) * 10) / 10, nodes: m.Nodes, listeners: m.JSEventListeners };
}

async function openPage(browser: any, save: SaveData | null) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.addInitScript(PROBE);
  await ctx.addInitScript(`Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => ${MODE === 'eco' ? 2 : 8}, configurable: true });`);
  if (NOAUDIO) await ctx.addInitScript(`for (const k of ['AudioContext','webkitAudioContext','OfflineAudioContext','webkitOfflineAudioContext']) { try { Object.defineProperty(window, k, { value: undefined, configurable: true }); } catch (e) {} }`);
  if (process.env.INJECT_CSS) await ctx.addInitScript(`document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(process.env.INJECT_CSS)}; document.head.appendChild(s); });`);
  if (save) {
    await ctx.addInitScript(([k, v]: string[]) => { try { if (!sessionStorage.getItem('__s')) { localStorage.setItem(k, v); sessionStorage.setItem('__s', '1'); } } catch { /* */ } }, [KEY, JSON.stringify(save)]);
  }
  const page: Page = await ctx.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(BASE + '/');
  // aquece o Playwright (1ª chamada compila o script injetado: ~100 ms a 6x que NÃO é do app)
  await page.evaluate(() => 1);
  await page.waitForFunction(() => true, null, { polling: 100 });
  await page.locator('body').boundingBox();
  return { ctx, page, cdp, errs };
}

/** Toque por coordenadas (evita a verificação de acionabilidade do Playwright dentro da janela medida). */
async function tap(page: Page, sel: string): Promise<void> {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error('sem caixa: ' + sel);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
const waitText = (page: Page, re: string, timeout: number) =>
  page.waitForFunction((r) => [].slice.call(document.querySelectorAll('button')).some((b: HTMLElement) => new RegExp(r).test(b.textContent || '') && b.offsetParent), re, { timeout, polling: 200 });
const trailCount = (p: Page) => p.evaluate(() => document.querySelectorAll('.tr-main .tc.on').length);
const throttle = (cdp: CDPSession, rate: number) => cdp.send('Emulation.setCPUThrottlingRate', { rate });

async function finish(page: Page, cdp: CDPSession): Promise<void> {
  await throttle(cdp, 1);
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const term = page.getByRole('button', { name: /TERMINAR/ });
    const cont = page.getByRole('button', { name: /CONTINUAR/ });
    const gift = page.getByRole('button', { name: /PEGAR/ });
    if (await term.isVisible().catch(() => false)) await term.click();
    else if (await cont.isVisible().catch(() => false)) await cont.click();
    else if (await gift.isVisible().catch(() => false)) await gift.click();
    else if (await page.locator('button.play').isEnabled().catch(() => false)) return;
    await page.waitForTimeout(150);
  }
}

/** Marcas máximas: 30 bolas, as mais compartilhadas entre as cartelas ao final (≤ 11 marcas por cartela, sem bingo). */
function marksSave(): SaveData {
  const s = baseSave(7);
  const cnt = new Map<number, number[]>();
  s.cards.forEach((c, i) => c.nums.forEach((n) => (cnt.get(n) ?? cnt.set(n, []).get(n)!).push(i)));
  const per = [0, 0, 0, 0];
  const marks: number[] = [];
  for (const [n, cs] of [...cnt.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (marks.length >= 20) break;
    if (cs.some((c) => per[c] >= 11)) continue;
    cs.forEach((c) => per[c]++);
    marks.push(n);
  }
  const f = fillers(s.cards, 60);
  const main = [...f.slice(0, 10), ...marks];
  let k = 10;
  while (main.length < 30) main.push(f[k++]);
  s.settings.speed = NOAUDIO ? 'rapida' : 'lenta';
  s.settings.turbo = false;
  return withRound(s, { main, extras: f.slice(k, k + 9) }, { mainIdx: 0, credits: 980 });
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  const out: { rate: number; results: SceneResult[]; mem: Record<string, any>; errors: string[] } = { rate: RATE, results: [], mem: {}, errors: [] };
  const push = (r: SceneResult) => { out.results.push(r); console.error(`[${RATE}x] ${r.scene}: maxTask ${r.maxTaskMs} ms, >50: ${r.tasksOver50}, fps ${r.fps}, pior quadro ${r.worstFrameMs} ms, INP ${r.inpMs ?? '-'}${r.extra ? ' ' + JSON.stringify(r.extra) : ''}${process.env.PARTS ? '\n     ' + r.top3.map((t) => t.ms + ': ' + t.parts).join('\n     ') : ''}`); };

  for (const name of names) {
    if (name === 'enter') {
      const s = baseSave(2);
      const { ctx, page, cdp, errs } = await openPage(browser, s);
      await throttle(cdp, RATE);
      push(await sceneWindow(page, cdp, 'enter (12 s)', () => page.getByText('ENTRAR').click(), 12000));
      out.errors.push(...errs);
      await ctx.close();
    }
    if (name === 'livre') {
      const s = baseSave(2);
      s.settings.speed = 'rapida';
      s.settings.turbo = false;
      const { ctx, page, cdp, errs } = await openPage(browser, s);
      await page.getByText('ENTRAR').click();
      await page.locator('button.play').waitFor();
      await page.waitForTimeout(WARM_MS);
      await throttle(cdp, RATE);
      out.mem.livreIdle = await mem(page, cdp);
      // abrir painel (Ajustes) e tabela de prêmios
      push(await sceneWindow(page, cdp, 'abrir Ajustes', async () => { await tap(page, '.gear'); await page.waitForFunction(() => !!document.querySelector('.layer:not(.hide)'), null, { polling: 100 }); }, 600));
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /FECHAR|Fechar|VOLTAR/ }).first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      // sorteio sem Turbo (bola a bola) ~8 bolas
      push(await sceneWindow(page, cdp, 'sorteio sem Turbo (8 bolas)', async () => { await tap(page, 'button.play'); }, 11000, async () => ({ bolas: await trailCount(page) })));
      out.mem.livreSorteio = await mem(page, cdp);
      // liga o Turbo no meio da rodada: o resto das bolas de uma vez
      const had = await trailCount(page);
      push(await sceneWindow(page, cdp, `Turbo no meio (+${30 - had} bolas)`, async () => { await tap(page, '.g-turbo'); await page.waitForFunction(() => document.querySelectorAll('.tr-main .tc.on').length === 30, null, { timeout: 15000, polling: 50 }); }, 800, async () => ({ marcadas: await page.evaluate(() => document.querySelectorAll('.card .cell.mk').length) })));
      await finish(page, cdp);
      await throttle(cdp, RATE);
      // Turbo direto: JOGAR com Turbo já ligado -> 30 bolas
      push(await sceneWindow(page, cdp, 'Turbo direto (JOGAR, 30 bolas)', async () => { await tap(page, 'button.play'); await page.waitForFunction(() => document.querySelectorAll('.tr-main .tc.on').length === 30, null, { timeout: 15000, polling: 50 }); }, 1500, async () => ({ marcadas: await page.evaluate(() => document.querySelectorAll('.card .cell.mk').length) })));
      out.mem.livreTurbo = await mem(page, cdp);
      await finish(page, cdp);
      out.errors.push(...errs);
      await ctx.close();
    }
    if (name === 'marcas') {
      const s = marksSave();
      const { ctx, page, cdp, errs } = await openPage(browser, s);
      await page.getByText('ENTRAR').click();
      await page.waitForFunction(() => document.querySelectorAll('.tr-main .tc.on').length >= 10, null, { timeout: 120000 });
      await throttle(cdp, RATE);
      push(await sceneWindow(page, cdp, 'Turbo + ~30 células marcadas', async () => { await tap(page, '.g-turbo'); await page.waitForFunction(() => document.querySelectorAll('.tr-main .tc.on').length === 30, null, { timeout: 20000, polling: 50 }); }, 1500, async () => ({ marcadas: await page.evaluate(() => document.querySelectorAll('.card .cell.mk').length) })));
      await finish(page, cdp);
      out.errors.push(...errs);
      await ctx.close();
    }
    if (name === 'bingo') {
      const s = nearBingo({ mainIdx: 14, turbo: false });
      s.settings.speed = 'lenta';
      const { ctx, page, cdp, errs } = await openPage(browser, s);
      await page.getByText('ENTRAR').click();
      await page.waitForFunction(() => document.querySelectorAll('.tr-main .tc.on').length >= 26, null, { timeout: 120000 });
      await throttle(cdp, RATE);
      push(await sceneWindow(page, cdp, 'comemoração de bingo (4 bolas + festa)', async () => { await waitText(page, 'CONTINUAR', 60000); }, 3500, async () => ({ confete: await page.evaluate(() => document.querySelectorAll('.confetti > *').length) })));
      await finish(page, cdp);
      out.errors.push(...errs);
      await ctx.close();
    }
    if (name === 'extra') {
      const s = nearDouble({ mainIdx: 12, turbo: false });
      s.settings.speed = 'lenta';
      const { ctx, page, cdp, errs } = await openPage(browser, s);
      await page.getByText('ENTRAR').click();
      await page.waitForFunction(() => document.querySelectorAll('.tr-main .tc.on').length >= 26, null, { timeout: 120000 });
      await throttle(cdp, RATE);
      push(await sceneWindow(page, cdp, 'oferta de bola extra (aparece)', async () => { await page.waitForFunction(() => { const b = document.querySelector('.xbuy') as HTMLElement | null; return !!b && !!b.offsetParent; }, null, { timeout: 60000, polling: 100 }); }, 2000));
      push(await sceneWindow(page, cdp, 'BOLA EXTRA (toque + bola)', async () => { await tap(page, '.xbuy'); await page.waitForFunction(() => document.querySelectorAll('.tr-extra .tc.on').length >= 1, null, { timeout: 15000, polling: 100 }); }, 2500));
      await finish(page, cdp);
      out.errors.push(...errs);
      await ctx.close();
    }
  }
  await browser.close();
  if (outArg) writeFileSync(outArg, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
