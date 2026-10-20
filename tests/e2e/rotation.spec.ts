// Rotação no APP REAL (build de produção): 1280x800 -> 800x1280 -> 844x390 -> 1280x800 no meio do sorteio e na oferta de bola extra.
// Confere que o estado (créditos, bolas, contador, oferta) não muda com a rotação e que nada fica fora da tela.
import { test, expect, type Page } from '@playwright/test';
import { KEY, baseSave, nearDouble } from './qa/fixtures';
import type { SaveData } from '../../src/types';

const SEQ = [
  { width: 1280, height: 800 },
  { width: 800, height: 1280 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
];

async function boot(page: Page, save: SaveData) {
  await page.addInitScript(
    ([k, v]) => {
      try {
        if (!sessionStorage.getItem('__seeded')) {
          localStorage.setItem(k as string, v as string);
          sessionStorage.setItem('__seeded', '1');
        }
      } catch {
        /* ignora */
      }
    },
    [KEY, JSON.stringify(save)],
  );
  await page.setViewportSize(SEQ[0]);
  await page.goto('/');
  await page.getByText('ENTRAR').click();
}

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const t = (s: string) => (document.querySelector(s)?.textContent || '').trim();
    const vis = (s: string) => {
      const e = document.querySelector(s) as HTMLElement | null;
      return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
    };
    return {
      credits: t('.cred .val'),
      balls: document.querySelectorAll('.tr-main .tc.on').length,
      extraBalls: document.querySelectorAll('.tr-extra .tc.on').length,
      counter: t('.ballsec .counter'),
      offer: vis('.xpanel:not(.hide) .xbuy'),
      offerTitle: t('.xpanel:not(.hide) .xtitle'),
      offerRemain: t('.xpanel:not(.hide) .xrem'),
      marked: document.querySelectorAll('.card .cell.mk').length,
      play: (document.querySelector('button.play') as HTMLButtonElement | null)?.disabled,
    };
  });

/** Layout: sem rolagem, botões e as 4 cartelas dentro da tela, logo e JOGAR visíveis. */
const layoutProblems = (page: Page, label: string) =>
  page.evaluate((label) => {
    const out: string[] = [];
    const vw = innerWidth, vh = innerHeight;
    const de = document.documentElement;
    if (de.scrollHeight > vh + 1 || de.scrollWidth > vw + 1) out.push(`${label}: rolagem ${de.scrollWidth}x${de.scrollHeight} > ${vw}x${vh}`);
    const inside = (e: Element, name: string) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { out.push(`${label}: ${name} sem tamanho`); return; }
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push(`${label}: ${name} fora da tela (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`);
    };
    document.querySelectorAll('button').forEach((b) => {
      const r = b.getBoundingClientRect();
      let hidden = r.width === 0 || r.height === 0;
      for (let p: Element | null = b; p && !hidden; p = p.parentElement) hidden = getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden';
      if (!hidden) inside(b, 'botão "' + (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 18) + '"');
    });
    const cards = document.querySelectorAll('.card');
    if (cards.length !== 4) out.push(`${label}: ${cards.length} cartelas`);
    cards.forEach((c, i) => inside(c, 'cartela ' + (i + 1)));
    const logo = document.querySelector('.top .logo');
    if (!logo) out.push(`${label}: logo ausente`);
    else inside(logo, 'logo');
    return out;
  }, label);

test.describe('rotação no app real', () => {
  test('no meio do sorteio: estado e layout preservados', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const s = baseSave(21);
    s.settings.speed = 'lenta';
    s.settings.turbo = false;
    await boot(page, s);
    await page.locator('button.play').click();
    await expect.poll(() => page.locator('.tr-main .tc.on').count(), { timeout: 30000 }).toBeGreaterThanOrEqual(2);
    let prev = await snapshot(page);
    const credits = prev.credits;
    for (const vp of [...SEQ.slice(1), ...SEQ.slice(0, 1)]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(700);
      const cur = await snapshot(page);
      // créditos não mudam no meio da rodada; bolas e marcas só crescem; o contador acompanha as bolas
      expect(cur.credits, `créditos em ${vp.width}x${vp.height}`).toBe(credits);
      expect(cur.balls, `bolas em ${vp.width}x${vp.height}`).toBeGreaterThanOrEqual(prev.balls);
      expect(cur.balls).toBeLessThanOrEqual(prev.balls + 2); // 700 ms de espera: no máximo uma ou duas bolas novas
      expect(cur.marked).toBeGreaterThanOrEqual(prev.marked);
      expect(cur.counter).toContain(String(cur.balls));
      expect(cur.play).toBe(true); // JOGAR segue desabilitado durante a rodada
      expect(await layoutProblems(page, `${vp.width}x${vp.height}`)).toEqual([]);
      prev = cur;
    }
    expect(errors).toEqual([]);
  });

  test('na oferta de bola extra: oferta, créditos e cartelas preservados', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const s = nearDouble({ credits: 800, turbo: false });
    await boot(page, s);
    await expect(page.locator('.xpanel:not(.hide) .xbuy')).toBeVisible({ timeout: 30000 });
    const ref = await snapshot(page);
    expect(ref.offer).toBe(true);
    for (const vp of [...SEQ.slice(1), ...SEQ.slice(0, 1)]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(500);
      const cur = await snapshot(page);
      expect(cur, `estado em ${vp.width}x${vp.height}`).toEqual(ref);
      await expect(page.locator('.xpanel:not(.hide) .xbuy')).toBeVisible();
      await expect(page.getByRole('button', { name: /TERMINAR/ })).toBeVisible();
      expect(await layoutProblems(page, `${vp.width}x${vp.height}`)).toEqual([]);
    }
    // a oferta continua válida depois de girar: comprar a bola extra funciona
    await page.locator('.xbuy').click();
    await expect.poll(() => page.locator('.tr-extra .tc.on').count(), { timeout: 15000 }).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('na comemoração: festa e botão CONTINUAR visíveis em todas as orientações', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const { nearBingo } = await import('./qa/fixtures');
    const s = nearBingo({ mainIdx: 29, turbo: false });
    s.settings.light = false;
    s.settings.lightManual = true;
    await boot(page, s);
    await expect(page.getByRole('button', { name: /CONTINUAR/ })).toBeVisible({ timeout: 30000 });
    const ref = await page.locator('.celeb .big').first().textContent();
    for (const vp of [...SEQ.slice(1), ...SEQ.slice(0, 1)]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(400);
      await expect(page.getByRole('button', { name: /CONTINUAR/ })).toBeVisible();
      expect(await page.locator('.celeb .big').first().textContent()).toBe(ref);
      const bad = await layoutProblems(page, `${vp.width}x${vp.height}`);
      // por trás do diálogo os botões do jogo continuam dentro da tela
      expect(bad).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});
