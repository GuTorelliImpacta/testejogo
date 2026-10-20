// Teste de fumaça num Chromium ANTIGO (piso Chrome 60) com CDP cru (o Playwright atual não fala com ele).
// Uso: OLD_CHROME=/caminho/chrome-linux/chrome [LD_LIBRARY_PATH=stub] QA_BASE=http://localhost:4181 node scripts/qa/oldchrome-smoke.mjs [saida.png]
// Obter o binário: https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/474900/chrome-linux.zip (Chromium 60.0.3112.0);
// se faltar libgconf-2.so.4, crie uma biblioteca vazia com os símbolos gconf_* (ver docs/qa/compat-fase3.md).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXE = process.env.OLD_CHROME;
const BASE = process.env.QA_BASE ?? 'http://localhost:4181';
const SHOT = process.argv[2];
const W = Number(process.env.VW ?? 1280), H = Number(process.env.VH ?? 800);
if (!EXE) throw new Error('defina OLD_CHROME');
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(EXE, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'oc-'))}`, `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch { /* subindo */ }
  await sleep(250);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); // WebSocket global (Node >= 22)
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG ' + m.params.entry.text + ' ' + (m.params.entry.url ?? ''));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); if (process.env.DBG) console.error(JSON.stringify(r).slice(0, 300)); return r.result?.result?.value; };
for (const d of ['Runtime', 'Page', 'Log']) await send(d + '.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/' });
await sleep(2500);
const out = {};
out.ua = await ev('navigator.userAgent');
out.appMounted = await ev('!!document.querySelector(".altina")');
out.cells = await ev('document.querySelectorAll(".cell").length');
out.scrollOk = await ev('document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1');
out.cellFont = await ev('getComputedStyle(document.querySelector(".cell")).fontSize');
out.padTop = await ev('getComputedStyle(document.querySelector(".altina")).paddingTop');
out.fontBigPrize = await ev('1');
await ev('document.querySelector(".splash .btn").click()');
await sleep(1500);
out.hasPlay = await ev('!!document.querySelector("button.play") && !document.querySelector("button.play").disabled');
await ev('document.querySelector(".g-turbo").click()');
await ev('document.querySelector("button.play").click()');
let ok = false;
for (let i = 0; i < 120 && !ok; i++) {
  await sleep(500);
  ok = await ev(`(function(){ var b=[].slice.call(document.querySelectorAll('button')); var t=b.filter(function(x){return /TERMINAR/.test(x.textContent)&&x.offsetParent})[0]; if(t) t.click(); var c=b.filter(function(x){return /CONTINUAR/.test(x.textContent)&&x.offsetParent})[0]; if(c) c.click(); var g=b.filter(function(x){return /PEGAR/.test(x.textContent)&&x.offsetParent})[0]; if(g) g.click(); var p=document.querySelector('button.play'); return document.querySelectorAll('.tr-main .tc.on').length===30 && p && !p.disabled; })()`);
}
out.roundFinished = ok;
out.marked = await ev('document.querySelectorAll(".cell.mk").length');
out.credits = await ev('document.querySelector(".cred .val").textContent');
out.swSupported = await ev('"serviceWorker" in navigator');
out.audioCtx = await ev('typeof (window.AudioContext||window.webkitAudioContext)');
out.offlineAudioCtx = await ev('typeof (window.OfflineAudioContext||window.webkitOfflineAudioContext)');
out.errors = errors;
if (SHOT) { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(SHOT, Buffer.from(s.result.data, 'base64')); }
console.log(JSON.stringify(out, null, 1));
ws.close(); proc.kill();
process.exit(errors.length || !out.roundFinished ? 1 : 0);
