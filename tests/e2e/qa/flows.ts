// Fluxos reais no app de produção: rodada, narração, acelerar, retomada, offline, timers.
import { chromium, type Page, type BrowserContext } from '@playwright/test';
import { BASE, EXE, KEY, baseSave, roundNearBingo, roundBingoOnExtra } from './fixtures';

const INIT = `
window.__name = (f) => f;
window.__log = { utter: [], intervals: 0, timeouts: 0, live: new Set(), raf: 0 };
const _si = window.setInterval; window.setInterval = function(...a){ window.__log.intervals++; return _si.apply(this,a); };
const _st = window.setTimeout, _ct = window.clearTimeout;
window.setTimeout = function(fn, ms, ...r){ const id = _st.call(this, function(){ window.__log.live.delete(id); return typeof fn==='function'?fn(...r):0; }, ms); window.__log.live.add(id); return id; };
window.clearTimeout = function(id){ window.__log.live.delete(id); return _ct.call(this,id); };
const _ra = window.requestAnimationFrame; window.requestAnimationFrame = function(f){ window.__log.raf++; return _ra.call(this,f); };
try {
  const ss = window.speechSynthesis;
  if (ss) {
    const t0 = performance.now();
    ss.speak = function(u){ window.__log.utter.push({ t: Math.round(performance.now()-t0), text: u.text }); setTimeout(() => { try { u.onend && u.onend(new Event('end')); } catch(e){} }, 350); };
    ss.cancel = function(){};
    ss.getVoices = function(){ return []; };
  }
} catch(e){}
`;

async function ctxFor(browser: any, save: unknown, vp = { width: 1280, height: 800 }) {
  const ctx: BrowserContext = await browser.newContext({ viewport: vp, serviceWorkers: 'block' });
  await ctx.addInitScript(INIT);
  if (save) await ctx.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem(k as string, v as string); sessionStorage.setItem('__seeded', '1'); } } catch {} }, [KEY, JSON.stringify(save)]);
  return ctx;
}
const saved = (p: Page) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const log = (p: Page) => p.evaluate(() => ({ utter: (window as any).__log.utter, intervals: (window as any).__log.intervals, live: (window as any).__log.live.size }));
const out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };

async function finishRound(p: Page, timeout = 150_000, opts: { buy?: boolean } = {}) {
  const t0 = Date.now();
  const seen: string[] = [];
  while (Date.now() - t0 < timeout) {
    const term = p.getByRole('button', { name: /TERMINAR/ });
    const buy = p.getByRole('button', { name: /BOLA EXTRA/ });
    const cont = p.getByRole('button', { name: /CONTINUAR/ });
    const gift = p.getByRole('button', { name: /PEGAR/ });
    if (await buy.isVisible().catch(() => false)) { seen.push('oferta'); if (opts.buy) await buy.click(); else await term.click(); }
    else if (await cont.isVisible().catch(() => false)) { seen.push('celebracao'); await cont.click(); }
    else if (await gift.isVisible().catch(() => false)) { seen.push('presente'); await gift.click(); }
    else if (await p.locator('button.play').isEnabled().catch(() => false)) return { ok: true, seen };
    await p.waitForTimeout(250);
  }
  return { ok: false, seen };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });

  // ---- 1) rodada completa 1 toque + narração normal
  {
    const ctx = await ctxFor(browser, baseSave(7));
    const p = await ctx.newPage();
    const errs: string[] = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    const caps: string[] = [];
    await p.waitForTimeout(600);
    const before = await saved(p);
    await p.locator('button.play').click();
    const t0 = Date.now();
    const capTimer = setInterval(async () => { try { const t = await p.locator('.caption.on').first().textContent({ timeout: 200 }); if (t && caps[caps.length - 1] !== t) caps.push(t); } catch {} }, 150);
    const r = await finishRound(p);
    clearInterval(capTimer);
    const l = await log(p);
    const after = await saved(p);
    say(`[1] rodada completa 1 toque: terminou=${r.ok} em ${((Date.now() - t0) / 1000).toFixed(1)}s, eventos=${r.seen.join(',') || '-'}, créditos ${before.credits}->${after.credits}`);
    say(`[1] falas (${l.utter.length}): ${l.utter.slice(0, 14).map((u: any) => `${u.t}:${u.text}`).join(' | ')} ...`);
    say(`[1] legendas capturadas: ${caps.slice(0, 12).join(' | ')}`);
    say(`[1] setInterval chamados: ${l.intervals}; timeouts vivos após fim: ${l.live}; erros: ${JSON.stringify(errs)}`);
    await p.waitForTimeout(4000);
    const idle = await p.evaluate(() => ({ live: (window as any).__log.live.size, anims: document.getAnimations().length, confetti: document.querySelectorAll('.confetti').length }));
    say(`[1] ocioso após 4s: timeouts vivos=${idle.live}, animações CSS ativas=${idle.anims}, confete no DOM=${idle.confetti}`);
    await ctx.close();
  }

  // ---- 2) acelerar: só prêmios narrados
  {
    const ctx = await ctxFor(browser, baseSave(8));
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(600);
    await p.locator('button.play').click();
    await p.waitForTimeout(6500);
    const pre = (await log(p)).utter.length;
    const t1 = Date.now();
    await p.locator('button.s3').click();
    const r = await finishRound(p, 60_000);
    const l = await log(p);
    say(`[2] acelerar: terminou=${r.ok} em ${((Date.now() - t1) / 1000).toFixed(1)}s após o toque; falas após acelerar: ${l.utter.slice(pre).map((u: any) => u.text).join(' | ')}`);
    await ctx.close();
  }

  // ---- 3) retomada ao recarregar
  {
    const ctx = await ctxFor(browser, baseSave(9));
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(500);
    await p.locator('button.play').click();
    await p.waitForTimeout(9000);
    await p.waitForTimeout(400);
    const s1 = await saved(p);
    const histBefore = await p.evaluate(() => document.querySelectorAll('.hist i.on, .hist i.drawn, .hist i[class*=" on"]').length);
    say(`[3] antes do reload: créditos(save)=${s1.credits} mainIdx=${s1.round?.mainIdx} bolas=${s1.round?.plan.main.slice(0, s1.round.mainIdx).join(',')}`);
    await p.reload();
    await p.waitForTimeout(500);
    const s2 = await saved(p);
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(1500);
    const v = await p.evaluate(() => ({ credits: document.querySelector('.cred .val')?.textContent, playDisabled: (document.querySelector('button.play') as HTMLButtonElement).disabled, hist: [...document.querySelectorAll('.hist i')].filter((e) => e.className.split(' ').length > 1 && !/^r\d$/.test(e.className)).map((e) => e.textContent).join(',') }));
    say(`[3] após reload+ENTRAR: créditos=${v.credits} JOGAR desabilitado=${v.playDisabled} histórico destacado=${v.hist}`);
    const r = await finishRound(p);
    const s3 = await saved(p);
    say(`[3] retomada terminou=${r.ok}; créditos finais=${s3.credits}; (mesmo débito: início ${s1.credits}); rodadas=${s3.stats.rodadas}`);
    await ctx.close();
  }

  // ---- 3b) reload na oferta de bola extra e depois de comprar
  {
    const ctx = await ctxFor(browser, roundNearBingo(30));
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    await p.waitForSelector('text=TERMINAR');
    const s = await saved(p);
    await p.getByRole('button', { name: /BOLA EXTRA/ }).click();
    await p.waitForTimeout(1500);
    const s2 = await saved(p);
    say(`[3b] oferta: créditos ${s.credits} -> após comprar ${s2.credits}, extrasUsed=${s2.round?.extrasUsed}`);
    await p.reload();
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(1500);
    const s3 = await saved(p);
    say(`[3b] após reload: créditos(save)=${s3.credits} extrasUsed=${s3.round?.extrasUsed}; botões=${await p.locator('.layer:not(.hide) button').allTextContents()}`);
    await ctx.close();
  }
  // ---- 3c) reload durante a celebração (pós-liquidação)
  {
    const ctx = await ctxFor(browser, roundNearBingo(29));
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    await p.getByRole('button', { name: /TERMINAR/ }).click({ timeout: 30000 });
    await p.waitForSelector('text=CONTINUAR');
    await p.waitForTimeout(500);
    const s = await saved(p);
    await p.reload();
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(1200);
    const s2 = await saved(p);
    say(`[3c] celebração + reload: créditos antes=${s.credits}, depois=${s2.credits}, round=${JSON.stringify(s2.round)?.slice(0, 40)}, JOGAR habilitado=${await p.locator('button.play').isEnabled()}, bingos=${s2.director.historicoBingos.length}`);
    await ctx.close();
  }
  // ---- 3d) reload com bola extra paga e oferta ativa no meio de extras (credits)
  // ---- 4) bingo na extra + acumulado só até 30
  {
    const ctx = await ctxFor(browser, roundBingoOnExtra(30));
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    await p.waitForSelector('text=TERMINAR');
    const c0 = (await saved(p)).credits;
    await p.getByRole('button', { name: /BOLA EXTRA/ }).click();
    await p.waitForSelector('text=CONTINUAR', { timeout: 30000 });
    const txt = await p.locator('.celeb').innerText();
    await p.getByRole('button', { name: /CONTINUAR/ }).click();
    await p.waitForTimeout(1500);
    const s = await saved(p);
    say(`[4] bingo na bola extra: celebração="${txt.replace(/\n/g, ' / ')}" créditos ${c0} -> ${s.credits} (esperado ~ ${c0} - custo + 1500, sem acumulado); acumulado=${s.jackpot}`);
    await ctx.close();
  }
  // ---- 5) presente, bônus diário, auto-jogo
  {
    const sv = baseSave(10); sv.credits = 30;
    const ctx = await ctxFor(browser, sv);
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    await p.locator('button.play').click();
    await p.waitForSelector('text=PEGAR');
    say(`[5] presente: ${(await p.locator('.layer:not(.hide) .dlg').innerText()).replace(/\n/g, ' / ')}`);
    await p.getByRole('button', { name: /PEGAR/ }).click();
    await p.waitForTimeout(500);
    say(`[5] créditos após PEGAR=${(await saved(p)).credits}`);
    await ctx.close();
  }
  {
    const sv = baseSave(11); sv.lastDailyBonus = '';
    const ctx = await ctxFor(browser, sv);
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(800);
    say(`[5] bônus diário: créditos após entrar=${(await saved(p)).credits} (1000+300); modal visível=${await p.locator('.layer:not(.hide)').count()}; legenda="${await p.locator('.caption').textContent()}"; falas=${(await log(p)).utter.map((u: any) => u.text).join(' | ')}`);
    await p.reload(); await p.getByText('ENTRAR').click(); await p.waitForTimeout(500);
    say(`[5] bônus diário 2ª abertura no mesmo dia: créditos=${(await saved(p)).credits}`);
    await ctx.close();
  }
  {
    const sv = baseSave(12); sv.credits = 400; sv.settings.speed = 'rapida';
    const ctx = await ctxFor(browser, sv);
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(500);
    await p.locator('button.s4').click(); // automático
    await p.waitForTimeout(500);
    const rounds: number[] = [];
    const t0 = Date.now();
    let last = 0;
    while (Date.now() - t0 < 150_000) {
      const s = await saved(p);
      if (s && s.stats.rodadas !== last) { last = s.stats.rodadas; rounds.push(last); }
      if (await p.getByRole('button', { name: /BOLA EXTRA/ }).isVisible().catch(() => false)) { say(`[5] auto parou em oferta de bola extra (rodadas=${last}); auto=${await p.locator('button.s4').getAttribute('aria-pressed')}`); break; }
      if (await p.getByRole('button', { name: /CONTINUAR/ }).isVisible().catch(() => false)) { say(`[5] auto parou em celebração (rodadas=${last}); auto=${await p.locator('button.s4').getAttribute('aria-pressed')}`); break; }
      if (await p.getByRole('button', { name: /PEGAR/ }).isVisible().catch(() => false)) { say(`[5] auto chegou ao presente (rodadas=${last}); auto aria-pressed=${await p.locator('button.s4').getAttribute('aria-pressed')}`); await p.getByRole('button', { name: /PEGAR/ }).click(); await p.waitForTimeout(3500); say(`[5] 3,5s depois do PEGAR: JOGAR habilitado=${await p.locator('button.play').isEnabled()} (auto continua?) auto aria-pressed=${await p.locator('button.s4').getAttribute('aria-pressed')} rodadas=${(await saved(p)).stats.rodadas}`); break; }
      await p.waitForTimeout(400);
    }
    say(`[5] auto rodou ${rounds.length} rodadas seguidas em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    await ctx.close();
  }
  await browser.close();
})();
