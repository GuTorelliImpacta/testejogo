// QA v2: auditoria de layout no APP REAL (estados forçados via localStorage) em 5 viewports.
// Mede: rolagem, alvos < 64 px, texto < 20 px, espaçamento < 12 px, diálogos sem rolagem/FECHAR visível, cortes, sobreposição.
// Uso: npx tsx tests/e2e/qa/layout.ts [estado,estado]   (SHOT=docs/qa salva review2-<estado>-<WxH>.png)
import { mkdirSync } from 'node:fs';
import { VIEWPORTS, baseSave, blankRound, fillers, mkPlan, nearBingo, nearDouble, today, withRound } from './fixtures';
import { audit, launch, open } from './browser';
import type { Page } from '@playwright/test';
import type { SaveData } from '../../../src/types';

const only = process.argv[2]?.split(',');
const SHOT = process.env.SHOT;
const ALL_SHOTS = new Set(['idle', 'mail-arrived', 'mail-open', 'drawing', 'drawing-line', 'extra', 'extra-free', 'celebracao-dupla', 'celebracao-bingo', 'gift', 'prizes', 'settings']);

const withMail = (s: SaveData, kind: 'daily' | 'bonus' = 'daily'): SaveData => {
  s.lastDailyBonus = kind === 'daily' ? '2000-01-01' : today();
  s.mail = { day: today(), bonusToday: 0, playMs: 0, pending: { kind, amount: kind === 'daily' ? 300 : 40 } };
  return s;
};
const big = (s: SaveData): SaveData => { s.credits = 1234567; s.jackpot = 1234567; return s; };
const muito = (s: SaveData): SaveData => { s.settings.textSize = 'muito'; return s; };
const grande = (s: SaveData): SaveData => { s.settings.textSize = 'grande'; return s; };

function doubleFinal(): SaveData {
  const s = baseSave(5);
  const c0 = s.cards[0].nums;
  const plan = mkPlan(s.cards, { early: [...c0.slice(0, 5), ...c0.slice(5, 9)], late: [c0[9]] });
  return withRound(s, plan, { mainIdx: 29, credits: 800, turbo: true });
}
function lineEarly(): SaveData {
  const s = baseSave(5);
  const c0 = s.cards[0].nums;
  const plan = mkPlan(s.cards, { early: [...c0.slice(0, 5), ...c0.slice(5, 9)] }); // linha 0 + 4 da linha 1: "falta 1" a seguir
  s.settings.speed = 'lenta';
  return withRound(s, plan, { mainIdx: 9, credits: 980 });
}

type State = [string, () => SaveData | null, (p: Page) => Promise<void>];
const gear = async (p: Page) => { await p.locator('.top .gear').click(); await p.waitForTimeout(350); };
const pin = async (p: Page) => { for (let i = 0; i < 5; i++) await p.locator('.top .logo').click(); await p.waitForTimeout(350); };
const ent = async (p: Page, ms = 400) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(ms); };

const STATES: State[] = [
  ['splash', () => baseSave(), async () => {}],
  ['idle', () => baseSave(), (p) => ent(p)],
  ['mail-arrived', () => withMail(baseSave()), (p) => ent(p, 700)],
  ['mail-bonus', () => withMail(baseSave(), 'bonus'), (p) => ent(p, 700)],
  ['mail-open', () => withMail(baseSave()), async (p) => { await ent(p, 500); await p.locator('.mailb').click(); await p.waitForTimeout(600); }],
  ['idle-7digitos', () => big(baseSave()), (p) => ent(p, 900)],
  ['idle-bet10', () => { const s = baseSave(); s.bet = 10; s.credits = 12345; return s; }, (p) => ent(p, 600)],
  ['idle-bet1', () => { const s = baseSave(); s.bet = 1; return s; }, (p) => ent(p, 600)],
  ['idle-cartelas1', () => { const s = baseSave(); s.active = [true, false, false, false]; return s; }, (p) => ent(p, 600)],
  ['drawing', () => blankRound({ mainIdx: 8, credits: 980 }), (p) => ent(p, 900)],
  ['drawing-line', () => lineEarly(), (p) => ent(p, 900)],
  ['drawing-turbo', () => blankRound({ mainIdx: 8, credits: 980, turbo: true }), (p) => ent(p, 300)],
  ['extra', () => nearDouble({ free: [false] }), async (p) => { await ent(p, 300); await p.waitForSelector('.xpanel:not(.hide)', { timeout: 15000 }); await p.waitForTimeout(600); }],
  ['extra-free', () => nearDouble({ free: [true] }), async (p) => { await ent(p, 300); await p.waitForSelector('.xpanel:not(.hide)', { timeout: 15000 }); await p.waitForTimeout(600); }],
  ['extra-bingo', () => nearBingo({ mainIdx: 30, free: [false], extrasDecisive: true }), async (p) => { await ent(p, 300); await p.waitForSelector('.xpanel:not(.hide)', { timeout: 15000 }); await p.waitForTimeout(600); }],
  ['extra-7digitos', () => big(nearBingo({ mainIdx: 30, free: [false], bet: 10, extrasDecisive: true })), async (p) => { await ent(p, 300); await p.waitForSelector('.xpanel:not(.hide)', { timeout: 15000 }); await p.waitForTimeout(600); }],
  ['extra-3-de-9', () => { const s = nearBingo({ mainIdx: 30, bet: 2, credits: 3000, extrasDecisive: true, free: Array(9).fill(false), turbo: true }); s.round!.plan.extras = fillers(s.cards, 9); return s; }, async (p) => {
    await ent(p, 300);
    for (let i = 0; i < 3; i++) { await p.waitForSelector('.xpanel:not(.hide)', { timeout: 15000 }); await p.locator('.xbuy').click(); await p.waitForTimeout(1500); }
    await p.waitForSelector('.xpanel:not(.hide)', { timeout: 15000 }); await p.waitForTimeout(600);
  }],
  ['celebracao-dupla', () => doubleFinal(), async (p) => { await ent(p, 300); await p.waitForSelector('text=CONTINUAR', { timeout: 20000 }); await p.waitForTimeout(1700); }],
  ['celebracao-bingo', () => nearBingo({ mainIdx: 29, turbo: true }), async (p) => { await ent(p, 300); await p.waitForSelector('text=CONTINUAR', { timeout: 20000 }); await p.waitForTimeout(1700); }],
  ['celebracao-bingo-leve', () => { const s = nearBingo({ mainIdx: 29, turbo: true }); s.settings.light = true; s.settings.lightManual = true; return s; }, async (p) => { await ent(p, 300); await p.waitForSelector('text=CONTINUAR', { timeout: 20000 }); await p.waitForTimeout(1700); }],
  ['celebracao-7digitos', () => big(nearBingo({ mainIdx: 29, turbo: true, bet: 10 })), async (p) => { await ent(p, 300); await p.waitForSelector('text=CONTINUAR', { timeout: 20000 }); await p.waitForTimeout(1700); }],
  ['gift', () => { const s = baseSave(); s.credits = 20; return s; }, async (p) => { await ent(p); await p.locator('button.play').click(); await p.waitForSelector('text=PEGAR'); await p.waitForTimeout(500); }],
  ['prizes', () => baseSave(), async (p) => { await ent(p); await p.locator('.ptab').click(); await p.waitForTimeout(500); }],
  ['prizes-bet1', () => { const s = baseSave(); s.bet = 1; return s; }, async (p) => { await ent(p); await p.locator('.ptab').click(); await p.waitForTimeout(500); }],
  ['prizes-variado', () => baseSave(), async (p) => {
    await ent(p); await pin(p);
    for (const k of '1958') await p.locator('.keys button', { hasText: new RegExp(`^${k}$`) }).click();
    await p.waitForTimeout(300);
    await p.evaluate(() => { localStorage.setItem('altina-da-sorte:patternSet', 'variado'); });
    await p.reload(); await ent(p); await p.locator('.ptab').click(); await p.waitForTimeout(500);
  }],
  ['settings', () => baseSave(), async (p) => { await ent(p); await gear(p); }],
  ['settings-jogo', () => baseSave(), async (p) => { await ent(p); await gear(p); await p.locator('.tabs .tab').nth(1).click(); await p.waitForTimeout(300); }],
  ['settings-tela', () => baseSave(), async (p) => { await ent(p); await gear(p); await p.locator('.tabs .tab').nth(2).click(); await p.waitForTimeout(300); }],
  ['pin', () => baseSave(), async (p) => { await ent(p); await pin(p); }],
  ['admin', () => baseSave(), async (p) => { await ent(p); await pin(p); for (const k of '1958') await p.locator('.keys button', { hasText: new RegExp(`^${k}$`) }).click(); await p.waitForTimeout(500); }],
  ['idle-textogrande', () => grande(baseSave()), (p) => ent(p, 600)],
  ['idle-textomuito', () => muito(baseSave()), (p) => ent(p, 600)],
  ['mail-open-textomuito', () => muito(withMail(baseSave())), async (p) => { await ent(p, 500); await p.locator('.mailb').click(); await p.waitForTimeout(600); }],
  ['extra-textomuito', () => muito(nearDouble({ free: [true] })), async (p) => { await ent(p, 300); await p.waitForSelector('.xpanel:not(.hide)', { timeout: 15000 }); await p.waitForTimeout(600); }],
  ['celebracao-textomuito', () => muito(nearBingo({ mainIdx: 29, turbo: true })), async (p) => { await ent(p, 300); await p.waitForSelector('text=CONTINUAR', { timeout: 20000 }); await p.waitForTimeout(1700); }],
  ['settings-textomuito', () => muito(baseSave()), async (p) => { await ent(p); await gear(p); await p.locator('.tabs .tab').nth(1).click(); await p.waitForTimeout(300); }],
  ['prizes-textomuito', () => muito(baseSave()), async (p) => { await ent(p); await p.locator('.ptab').click(); await p.waitForTimeout(500); }],
  ['drawing-textomuito', () => muito(blankRound({ mainIdx: 8, credits: 980 })), (p) => ent(p, 900)],
];

(async () => {
  if (SHOT) mkdirSync(SHOT, { recursive: true });
  const browser = await launch();
  const all: string[] = [];
  let n = 0;
  for (const vp of VIEWPORTS) {
    for (const [name, mk, run] of STATES) {
      if (only && !only.includes(name)) continue;
      const c = await open(browser, mk(), { width: vp.w, height: vp.h });
      n++;
      try {
        await run(c.page);
      } catch (e) {
        all.push(`[${vp.w}x${vp.h} ${name}] FALHA ao forçar estado: ${String(e).split('\n')[0]}`);
      }
      const res = await audit(c.page, `${vp.w}x${vp.h} ${name}`);
      all.push(...res);
      if (SHOT) {
        const wanted = ALL_SHOTS.has(name) || (vp.w === 1280 || vp.w === 360);
        if (wanted) await c.page.screenshot({ path: `${SHOT}/review2-${name}-${vp.w}x${vp.h}.png` });
      }
      if (c.errs.length) all.push(`[${vp.w}x${vp.h} ${name}] ERROS JS: ${c.errs.join(' | ')}`);
      if (c.bad.length) all.push(`[${vp.w}x${vp.h} ${name}] REQUISIÇÕES RUINS: ${c.bad.join(' | ')}`);
      await c.ctx.close();
    }
  }
  await browser.close();
  console.log(all.length ? all.join('\n') : 'OK sem violações');
  console.log(`\n${n} combinações estado x viewport; ${all.length} achado(s)`);
})();
void blankRound;
