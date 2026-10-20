// Evidências de performance/PWA/M7/M8/M10/migração. Uso: node scripts/qa/perf-pwa.mjs (com `vite preview` em :4173)
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:4173';
const out = {};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const save = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('altina-da-sorte:v2') || 'null'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function finishRound(page, opts = {}) {
  const play = page.locator('button.play');
  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline) {
    const t = page.getByRole('button', { name: /TERMINAR/ });
    const c = page.getByRole('button', { name: /CONTINUAR/ });
    if (await t.isVisible().catch(() => false)) await t.click();
    else if (await c.isVisible().catch(() => false)) await c.click();
    else if (await play.isEnabled().catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}
async function turbo(page) { await page.getByRole('button', { name: /Turbo/ }).first().click({ timeout: 3000 }).catch(() => {}); }

// ---------- (2) tamanhos e 404 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const resp = [];
  page.on('response', async (r) => {
    let size = 0; try { size = (await r.body()).length; } catch {}
    resp.push({ url: r.url().replace(BASE, ''), status: r.status(), size, enc: r.headers()['content-encoding'] });
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const before = resp.slice();
  out.firstLoad = { requests: before.length, audioRequests: before.filter((r) => r.url.startsWith('/audio')).length, bytesRaw: before.reduce((a, r) => a + r.size, 0), list: before.map((r) => `${r.status} ${r.url} ${r.size}`) };
  await page.getByText('ENTRAR').click();
  await page.locator('button.play').waitFor();
  await page.locator('button.play').click();
  await turbo(page);
  out.roundFinished = await finishRound(page);
  const bad = resp.filter((r) => r.status >= 400);
  out.afterRound = { totalRequests: resp.length, audioRequests: resp.filter((r) => r.url.startsWith('/audio')).length, audioBytes: resp.filter((r) => r.url.startsWith('/audio')).reduce((a, r) => a + r.size, 0), responses400plus: bad };
  await ctx.close();
}

// ---------- (4) M7 / M8 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  out.viewport = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
  await ctx.close();
}
{
  // M7: FPS baixo forçado (rAF lento) -> só liga depois de 3 rodadas
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 120); // ~8 fps
  });
  await page.goto(BASE + '/');
  await page.getByText('ENTRAR').click();
  const light = async () => (await save(page))?.settings;
  const res = [];
  for (let i = 1; i <= 4; i++) {
    await page.locator('button.play').click();
    if (i === 1) await turbo(page);
    const ok = await finishRound(page);
    await sleep(3800); // janela de medição de 3 s do watchFps
    const s = await light();
    res.push({ afterRound: i, finished: ok, light: s.light, lightManual: s.lightManual });
  }
  out.m7auto = res;
  await ctx.close();
}
{
  // M7: escolha manual (light=false, lightManual=true) não é sobrescrita
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 120);
    if (!localStorage.getItem('altina-da-sorte:v2')) sessionStorage.setItem('first', '1');
  });
  await page.goto(BASE + '/');
  await page.getByText('ENTRAR').click();
  await page.locator('button.play').waitFor();
  // simula escolha manual via save + recarga
  await sleep(500);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('altina-da-sorte:v2')); s.settings.light = false; s.settings.lightManual = true; localStorage.setItem('altina-da-sorte:v2', JSON.stringify(s)); });
  await page.reload();
  await page.getByText('ENTRAR').click();
  const res = [];
  for (let i = 1; i <= 4; i++) {
    await page.locator('button.play').click();
    if (i === 1) await turbo(page);
    await finishRound(page);
    await sleep(3800);
    const s = (await save(page)).settings;
    res.push({ afterRound: i, light: s.light, lightManual: s.lightManual });
  }
  out.m7manual = res;
  await ctx.close();
}

// ---------- (4) M10 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.getByText('ENTRAR').click();
  const play = page.locator('button.play');
  await play.waitFor();
  let found = null;
  for (let attempt = 1; attempt <= 25 && !found; attempt++) {
    await play.click();
    await turbo(page);
    const deadline = Date.now() + 90_000;
    let state = null;
    while (Date.now() < deadline) {
      const extra = page.getByRole('button', { name: /BOLA EXTRA/ });
      const t = page.getByRole('button', { name: /TERMINAR/ });
      const c = page.getByRole('button', { name: /CONTINUAR/ });
      if (await extra.isVisible().catch(() => false)) {
        const label = (await extra.textContent()) || '';
        const s0 = await save(page);
        await extra.click();
        // espera a próxima oferta ou fim; registra o estado salvo com extraSpent > 0
        await sleep(2500);
        const s1 = await save(page);
        if (s1?.round && s1.round.extraSpent > 0) {
          found = { label, attempt, creditsBefore: s0.credits, apostadoTotal0: s0.stats.apostadoTotal, totalBet0: s1.round.bet * s1.round.active.filter(Boolean).length };
          break;
        }
        // não pago (grátis) ou rodada terminou: segue
      }
      if (await t.isVisible().catch(() => false)) await t.click();
      else if (await c.isVisible().catch(() => false)) await c.click();
      else if (await play.isEnabled().catch(() => false)) break;
      await sleep(200);
    }
  }
  if (!found) out.m10 = { error: 'nenhuma oferta paga comprada em 25 rodadas' };
  else {
    // pausa no estado salvo mais recente: recarrega
    const pre = await save(page);
    const preText = await page.locator('.stat.cred .val').textContent();
    await page.reload();
    const post = await save(page);
    await page.getByText('ENTRAR').click();
    await sleep(500);
    const postText = await page.locator('.stat.cred .val').textContent();
    // saldo exibido pode ter avançado se nova compra ocorreu; compara o salvo
    out.m10 = { found, preReload: { credits: pre.credits, extraSpent: pre.round?.extraSpent, extrasUsed: pre.round?.extrasUsed, mainIdx: pre.round?.mainIdx, uiCredits: preText }, postReload: { credits: post.credits, extraSpent: post.round?.extraSpent, extrasUsed: post.round?.extrasUsed, uiCreditsAfterEnter: postText } };
    // recusa novas ofertas e termina: extraCost do resumo deve = extraSpent (apostadoTotal delta = totalBet + extraSpent)
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      const t = page.getByRole('button', { name: /TERMINAR/ });
      const c = page.getByRole('button', { name: /CONTINUAR/ });
      if (await t.isVisible().catch(() => false)) await t.click();
      else if (await c.isVisible().catch(() => false)) await c.click();
      else if (await play.isEnabled().catch(() => false)) break;
      await sleep(200);
    }
    const fin = await save(page);
    const expect = pre.round.extraSpent + found.totalBet0;
    out.m10.final = { apostadoDelta: fin.stats.apostadoTotal - found.apostadoTotal0, esperadoMin: expect, note: 'delta >= esperado (mais compras após reload só aumentam)', ok: fin.stats.apostadoTotal - found.apostadoTotal0 >= expect };
  }
  await ctx.close();
}

// ---------- (5) migração v1 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    if (localStorage.getItem('altina-da-sorte:v2') || localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    const card = (o) => ({ nums: [1, 13, 25, 37, 49, 2, 14, 26, 38, 50, 3, 15, 27, 39, 51].map((n) => n + o) });
    localStorage.setItem('altina-da-sorte:v1', JSON.stringify({
      version: 1, credits: 4321, bet: 20,
      cards: [card(0), card(1), card(2), card(3)], active: [true, true, false, true], jackpot: 7123.45,
      settings: { speed: 'rapida', volMusic: 0.2, muted: true },
      director: { ultimoBingoEm: 111, bingosPorMes: { '2026-10': 2 }, rodadasDesdeUltimoBingo: 9, primeiroUsoEm: 5, historicoBingos: [100, 111] },
      stats: { rodadas: 77, apostado: 10, ganho: 8, apostadoTotal: 12, ganhoTotal: 9, rodadasPorDia: { '2026-10-19': 5 }, recargas: 2, porPadrao: { linha: 4 } },
      lastDailyBonus: '2026-10-19',
    }));
  });
  await page.goto(BASE + '/');
  await page.getByText('ENTRAR').click();
  await sleep(1500);
  const credTxt = await page.locator('.stat.cred .val').textContent();
  const jackTxt = await page.locator('.stat.jack .val').textContent();
  const s = await save(page);
  const allNums = s.cards.flatMap((c) => c.nums);
  out.migration = { uiCredits: credTxt, uiJackpot: jackTxt, version: s.version, bet: s.bet, credits: s.credits, jackpot: s.jackpot, cardsMax: Math.max(...allNums), cardsHave1to90: allNums.every((n) => n >= 1 && n <= 90), cardCount: s.cards.length, cardNumsPerCard: s.cards[0].nums.length, sameAsV1Cards: s.cards[0].nums.join() === [1, 13, 25, 37, 49, 2, 14, 26, 38, 50, 3, 15, 27, 39, 51].join(), speed: s.settings.speed, stats_rodadas: s.stats.rodadas, director_hist: s.director.historicoBingos, errors };
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 1));
