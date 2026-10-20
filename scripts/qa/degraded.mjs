// Modo degradado: o jogo precisa ABRIR e JOGAR uma rodada mesmo sem Web Audio, Wake Lock, Service Worker, voz do tablet,
// matchMedia().addEventListener, Element.animate, Notification de rede... (aparelho velho / WebView sem esses recursos).
// Uso: QA_BASE=http://localhost:4183 node scripts/qa/degraded.mjs
import { chromium } from '@playwright/test';
const BASE = process.env.QA_BASE ?? 'http://localhost:4181';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = (names) => `for (const k of ${JSON.stringify(names)}) { try { Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch (e) {} try { delete window[k]; } catch (e) {} }`;
const CASES = {
  'sem Web Audio (AudioContext/Offline)': kill(['AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'webkitOfflineAudioContext']),
  'só AudioContext prefixado, sem OfflineAudioContext': `window.webkitAudioContext = window.AudioContext; ${kill(['AudioContext', 'OfflineAudioContext', 'webkitOfflineAudioContext'])}`,
  'AudioContext que lança erro': `window.AudioContext = function () { throw new Error('sem audio'); }; window.webkitAudioContext = undefined;`,
  'sem speechSynthesis': kill(['speechSynthesis', 'SpeechSynthesisUtterance']),
  'sem Wake Lock': `try { Object.defineProperty(Navigator.prototype, 'wakeLock', { value: undefined, configurable: true }); } catch (e) {}`,
  'Wake Lock que recusa': `try { Object.defineProperty(Navigator.prototype, 'wakeLock', { value: { request: () => Promise.reject(new Error('NotAllowed')) }, configurable: true }); } catch (e) {}`,
  'sem Service Worker': `try { Object.defineProperty(Navigator.prototype, 'serviceWorker', { value: undefined, configurable: true }); } catch (e) {}`,
  'sem Cache Storage': kill(['caches']),
  'sem Element.animate (sem Web Animations)': `Element.prototype.animate = undefined;`,
  'MediaQueryList só com addListener': `(function(){ const mm = window.matchMedia.bind(window); window.matchMedia = function (q) { const m = mm(q); try { Object.defineProperty(m, 'addEventListener', { value: undefined }); Object.defineProperty(m, 'removeEventListener', { value: undefined }); } catch (e) {} return m; }; })();`,
  'sem deviceMemory / hardwareConcurrency': `try { Object.defineProperty(Navigator.prototype, 'deviceMemory', { value: undefined, configurable: true }); Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { value: undefined, configurable: true }); } catch (e) {}`,
  'localStorage lança erro (modo privativo)': `Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });`,
  'sem clipboard / sem fetch de voz (rede cai)': `try { Object.defineProperty(Navigator.prototype, 'clipboard', { value: undefined, configurable: true }); } catch (e) {}`,
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const res = [];
for (const [name, script] of Object.entries(CASES)) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  if (name.includes('rede cai')) await ctx.route('**/audio/**', (r) => r.abort());
  await ctx.addInitScript(script);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE + '/');
  let opened = false, played = false, admin = false;
  try {
    await page.getByText('ENTRAR').click({ timeout: 5000 });
    await page.locator('button.play').waitFor({ timeout: 8000 });
    opened = true;
    await page.getByRole('button', { name: /Turbo/ }).first().click().catch(() => {});
    await page.locator('button.play').click();
    for (let i = 0; i < 100 && !played; i++) {
      const t = page.getByRole('button', { name: /TERMINAR/ }), c = page.getByRole('button', { name: /CONTINUAR/ }), g = page.getByRole('button', { name: /PEGAR/ });
      if (await t.isVisible().catch(() => false)) await t.click(); else if (await c.isVisible().catch(() => false)) await c.click(); else if (await g.isVisible().catch(() => false)) await g.click();
      else if ((await page.locator('.tr-main .tc.on').count()) === 30 && (await page.locator('button.play').isEnabled().catch(() => false))) played = true;
      await sleep(200);
    }
    // abre Ajustes e a aba Aparelho do painel (não pode quebrar sem deviceMemory etc.)
    await page.locator('.gear').click();
    await page.locator('.layer:not(.hide)').first().waitFor({ timeout: 3000 });
    admin = true;
  } catch (e) { errs.push('fluxo: ' + String(e).slice(0, 120)); }
  res.push({ caso: name, abriu: opened, jogou: played, ajustes: admin, errosJS: errs });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(res, null, 1));
const bad = res.filter((r) => !r.abriu || !r.jogou || !r.ajustes || r.errosJS.length);
console.log(bad.length ? `FALHOU em ${bad.length} caso(s): ${bad.map((b) => b.caso).join('; ')}` : `OK: ${res.length} casos (abre, joga uma rodada e abre Ajustes)`);
process.exit(bad.length ? 1 : 0);
