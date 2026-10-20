import { chromium } from '@playwright/test';
import { BASE, EXE, KEY, baseSave, roundNearBingo } from './fixtures';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const mk = async (init: string, raw?: string) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await ctx.addInitScript('window.__name=(f)=>f;' + init);
    if (raw !== undefined) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('s')) { localStorage.setItem(k as string, v as string); sessionStorage.setItem('s', '1'); } }, [KEY, raw]);
    const p = await ctx.newPage();
    const errs: string[] = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    return { ctx, p, errs };
  };
  const state = async (p: any) => p.evaluate(() => ({ play: (document.querySelector('button.play') as HTMLButtonElement)?.disabled, modal: [...document.querySelectorAll('.layer:not(.hide) button')].map((b) => b.textContent), splash: !document.querySelector('.splash.hide') }));

  // 1) JSON inválido
  { const { ctx, p, errs } = await mk('', '{not json'); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(500); console.log('[R1] JSON inválido ->', JSON.stringify(await state(p)), errs); await ctx.close(); }
  // 2) localStorage lança exceção
  { const { ctx, p, errs } = await mk("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}});"); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(500); await p.locator('button.play').click(); await p.waitForTimeout(2500); console.log('[R2] sem localStorage, jogar ->', JSON.stringify(await state(p)), errs); await ctx.close(); }
  // 3) round salvo corrompido: sem extras, mainIdx 30
  { const s: any = roundNearBingo(30); delete s.round.plan.extras; const { ctx, p, errs } = await mk('', JSON.stringify(s)); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(2500); console.log('[R3] round sem plan.extras (mainIdx=30) ->', JSON.stringify(await state(p)), errs); await ctx.close(); }
  // 4) round salvo corrompido: plan.main curto
  { const s: any = roundNearBingo(10); s.round.plan.main = s.round.plan.main.slice(0, 12); const { ctx, p, errs } = await mk('', JSON.stringify(s)); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(4000); console.log('[R4] plan.main com 12 bolas ->', JSON.stringify(await state(p)), errs); await ctx.close(); }
  // 5) round com cards inválidos/active ausente
  { const s: any = roundNearBingo(5); delete s.round.active; const { ctx, p, errs } = await mk('', JSON.stringify(s)); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(3000); console.log('[R5] round sem active ->', JSON.stringify(await state(p)), errs); await ctx.close(); }
  // 6) toques repetidos em JOGAR / Acelerar
  { const { ctx, p, errs } = await mk('', JSON.stringify(baseSave(2))); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(400);
    await p.locator('button.play').dblclick(); await p.locator('button.play').click({ force: true }).catch(() => {}); await p.waitForTimeout(800);
    const cr = await p.evaluate(() => document.querySelector('.cred .val')?.textContent);
    console.log('[R6] duplo toque em JOGAR -> créditos', cr, '(esperado 980)', errs); await ctx.close(); }
  // 7) tocar célula/cartela durante o jogo, trocar cartelas durante o jogo, aposta durante o jogo
  { const { ctx, p, errs } = await mk('', JSON.stringify(baseSave(2))); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(300);
    await p.locator('button.play').click(); await p.waitForTimeout(500);
    const dis = await p.evaluate(() => ['button.s1', 'button.s2', 'button.s3', 'button.s4', '.bet-g button'].map((s) => [...document.querySelectorAll(s)].map((b) => (b as HTMLButtonElement).disabled)));
    console.log('[R7] durante o sorteio disabled: trocar,prêmios,acelerar,auto,aposta ->', JSON.stringify(dis), errs); await ctx.close(); }
  // 8) desativar cartelas: mínimo 1 ativa
  { const { ctx, p } = await mk('', JSON.stringify(baseSave(2))); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(300);
    for (let i = 0; i < 4; i++) await p.locator('.cards > *').nth(i).click({ force: true });
    const act = await p.evaluate(() => JSON.parse(localStorage.getItem('altina-da-sorte:v1')!)?.active); await p.waitForTimeout(400);
    const act2 = await p.evaluate(() => JSON.parse(localStorage.getItem('altina-da-sorte:v1')!)?.active);
    console.log('[R8] tocar 4 cartelas -> active=', JSON.stringify(act2), 'total=', await p.locator('.betbox .l2').textContent()); await ctx.close(); }
  // 9) hidden/visible no meio da rodada (aba em segundo plano)
  { const { ctx, p, errs } = await mk('', JSON.stringify(baseSave(2))); await p.goto(BASE + '/'); await p.getByText('ENTRAR').click(); await p.waitForTimeout(300); await p.locator('button.play').click(); await p.waitForTimeout(3000);
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(1000);
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(4000); const n = await p.evaluate(() => JSON.parse(localStorage.getItem('altina-da-sorte:v1')!).round?.mainIdx); console.log('[R9] segundo plano/volta: mainIdx após 8s =', n, errs); await ctx.close(); }
  await browser.close();
})();
