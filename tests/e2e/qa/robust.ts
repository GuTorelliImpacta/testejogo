// QA v2: robustez no app real: storage corrompido, sem localStorage, toques repetidos, segundo plano, rodada salva inválida.
// Uso: npx tsx tests/e2e/qa/robust.ts
import { baseSave, blankRound, KEY, nearDouble } from './fixtures';
import { credits, enter, finishRound, launch, open, saved } from './browser';

let fails = 0;
const chk = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${name}${info ? ' -> ' + info : ''}`);
};

(async () => {
  const browser = await launch();
  const usable = async (p: import('@playwright/test').Page) => p.evaluate(() => ({ play: !(document.querySelector('button.play') as HTMLButtonElement)?.disabled, layers: [...document.querySelectorAll('.layer:not(.hide) button')].length, splash: !document.querySelector('.splash.hide') }));

  // R1 JSON inválido
  {
    const c = await open(browser, null, undefined, { goto: false });
    await c.ctx.addInitScript((k) => { if (!sessionStorage.getItem('s')) { localStorage.setItem(k, '{nao json'); sessionStorage.setItem('s', '1'); } }, KEY);
    await c.page.goto('http://localhost:4181/');
    await enter(c.page);
    const u = await usable(c.page);
    chk('R1 JSON inválido: cai em save novo e o jogo é jogável', u.play && !u.splash, JSON.stringify(u) + ' ' + JSON.stringify(c.errs));
    await c.ctx.close();
  }
  // R2 sem localStorage
  {
    const c = await open(browser, null, undefined, { goto: false });
    await c.ctx.addInitScript("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}});");
    await c.page.goto('http://localhost:4181/');
    await enter(c.page);
    await c.page.locator('button.play').click();
    const r = await finishRound(c.page, 120_000);
    chk('R2 localStorage bloqueado: joga uma rodada inteira sem erro', r.ok && c.errs.length === 0, JSON.stringify(c.errs));
    await c.ctx.close();
  }
  // R3..R7 rodada salva corrompida: nunca trava
  const bads: [string, (s: any) => void][] = [
    ['sem plan.extras', (s) => delete s.round.plan.extras],
    ['plan.main com 12 bolas', (s) => (s.round.plan.main = s.round.plan.main.slice(0, 12))],
    ['bola 91 no plano (config v1/60 bolas)', (s) => (s.round.plan.main[0] = 91)],
    ['sem active', (s) => delete s.round.active],
    ['plan.free não-booleano', (s) => (s.round.plan.free = ['x'])],
    ['mainIdx 99', (s) => (s.round.mainIdx = 99)],
    ['extraSpent negativo', (s) => (s.round.extraSpent = -5)],
    ['aposta 20 (valor v1)', (s) => (s.round.bet = 20)],
    ['cartela com número fora da faixa', (s) => (s.cards[0].nums[0] = 90)],
    ['credits NaN/string', (s) => (s.credits = 'abc')],
    ['version 3', (s) => (s.version = 3)],
  ];
  for (const [label, mut] of bads) {
    const s: any = nearDouble({ credits: 800, turbo: true });
    mut(s);
    s.cards.forEach((c: any) => (c.nums ? 0 : 0));
    const c = await open(browser, s);
    await enter(c.page);
    await c.page.waitForTimeout(2500);
    const st = await c.page.evaluate(() => ({ play: !(document.querySelector('button.play') as HTMLButtonElement)?.disabled, xp: !!document.querySelector('.xpanel:not(.hide)'), cont: !!document.querySelector('.layer:not(.hide) .btn') }));
    chk(`R rodada salva inválida (${label}): o jogo não trava (JOGAR liberado ou oferta/modal com botão)`, st.play || st.xp || st.cont, JSON.stringify(st) + ' ' + JSON.stringify(c.errs));
    await c.ctx.close();
  }
  // R8 toques repetidos em JOGAR
  {
    const c = await open(browser, baseSave(2));
    await enter(c.page);
    await c.page.locator('button.play').dblclick();
    await c.page.locator('button.play').click({ force: true }).catch(() => {});
    await c.page.waitForTimeout(900);
    chk('R8 duplo/triplo toque em JOGAR debita 1 vez (980)', (await credits(c.page)) === '980', await credits(c.page));
    await c.ctx.close();
  }
  // R9 durante a rodada: controles desabilitados
  {
    const c = await open(browser, baseSave(2));
    await enter(c.page);
    await c.page.locator('button.play').click();
    await c.page.waitForTimeout(500);
    const dis = await c.page.evaluate(() => ['.g-bet .sq', '.g-cards .sq', '.g-nums', 'button.play'].map((s) => [...document.querySelectorAll(s)].every((b) => (b as HTMLButtonElement).disabled)));
    chk('R9 durante o sorteio: aposta, cartelas, Números e JOGAR desabilitados; Turbo habilitado', dis.every(Boolean) && !(await c.page.locator('.g-turbo').isDisabled()), JSON.stringify(dis));
    await c.ctx.close();
  }
  // R10 segundo plano e volta no meio da rodada
  {
    const c = await open(browser, blankRound({ credits: 980 }));
    await enter(c.page);
    await c.page.waitForTimeout(2500);
    await c.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await c.page.waitForTimeout(1000);
    await c.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const n0 = await c.page.locator('.trail .tr-main .tc.on').count();
    await c.page.waitForTimeout(5000);
    const n1 = await c.page.locator('.trail .tr-main .tc.on').count();
    chk('R10 segundo plano/volta: a rodada continua', n1 > n0, `${n0} -> ${n1}; salvo mainIdx=${(await saved(c.page)).round?.mainIdx}`);
    await c.ctx.close();
  }
  // R11 reload no meio de oferta paga: custo mantido e oferta volta
  {
    const c = await open(browser, nearDouble({ free: [false], credits: 800 }));
    await enter(c.page);
    await c.page.waitForSelector('.xpanel:not(.hide)');
    await c.page.reload();
    await enter(c.page);
    await c.page.waitForSelector('.xpanel:not(.hide)', { timeout: 10000 });
    chk('R11 reload na oferta: oferta volta, saldo 800 intacto', (await credits(c.page)) === '800');
    await c.ctx.close();
  }
  await browser.close();
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
