// Auditoria de layout: rolagem, alvos >= 64px, texto >= 20px, em 5 viewports e vários estados.
import { chromium, type Page } from '@playwright/test';
import { BASE, EXE, KEY, VIEWPORTS, baseSave, roundNearBingo, today } from './fixtures';

async function audit(page: Page, label: string) {
  return page.evaluate((label) => {
    const out: string[] = [];
    const vw = innerWidth, vh = innerHeight;
    const de = document.documentElement;
    if (de.scrollHeight > vh + 1 || de.scrollWidth > vw + 1) out.push(`ROLAGEM doc ${de.scrollWidth}x${de.scrollHeight} > ${vw}x${vh}`);
    const vis = (e: Element) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      for (let p: Element | null = e; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return true;
    };
    document.querySelectorAll('button, [role=button], textarea').forEach((b) => {
      if (!vis(b)) return;
      const r = (b as HTMLElement).getBoundingClientRect();
      const name = (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24);
      if (r.width < 63.5 || r.height < 63.5) out.push(`ALVO ${Math.round(r.width)}x${Math.round(r.height)} "${name}" .${(b as HTMLElement).className}`);
      if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) out.push(`FORA DA TELA "${name}" ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    });
    // espaçamento entre alvos adjacentes (<12px)
    const top = (e: Element) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, Math.min(vh - 1, Math.max(0, r.top + r.height / 2))); return !!t && (e === t || e.contains(t)); };
    const btns = [...document.querySelectorAll('button')].filter(vis).filter((b) => !b.closest('.hide')).filter(top);
    for (let i = 0; i < btns.length; i++)
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect();
        const dx = Math.max(a.left - b.right, b.left - a.right), dy = Math.max(a.top - b.bottom, b.top - a.bottom);
        const gap = Math.max(dx, dy);
        if (dx < 200 && dy < 200 && gap >= 0 && gap < 11.5 && (dx < 0 || dy < 0 || true) && Math.min(dx, dy) <= 0)
          out.push(`ESPAÇO ${Math.round(gap)}px entre "${btns[i].textContent?.trim().slice(0, 12)}" e "${btns[j].textContent?.trim().slice(0, 12)}"`);
      }
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = (n.textContent || '').trim();
      if (!t) continue;
      const el = n.parentElement!;
      if (el.closest('.sr, noscript, script, style, pre')) continue;
      if (!vis(el)) continue;
      if (getComputedStyle(el).opacity === '0') continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 19.99) {
        const k = `${el.className}|${t.slice(0, 20)}`;
        if (!seen.has(k)) { seen.add(k); out.push(`TEXTO ${fs}px "${t.slice(0, 24)}" .${el.className}`); }
      }
    }
    return out.map((o) => `[${label}] ${o}`);
  }, label);
}

async function seed(page: Page, save: unknown) {
  await page.addInitScript('window.__name = (f) => f;');
  await page.addInitScript(([k, v]) => { try { if (!localStorage.getItem('__qa_seeded')) { localStorage.setItem(k as string, v as string); localStorage.setItem('__qa_seeded', '1'); } } catch {} }, [KEY, JSON.stringify(save)]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
  const all: string[] = [];
  const states: [string, () => unknown, (p: Page) => Promise<void>][] = [
    ['splash', () => baseSave(), async () => {}],
    ['idle', () => baseSave(), async (p) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(500); }],
    ['prizes', () => baseSave(), async (p) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(300); await p.locator('button.s2').click(); await p.waitForTimeout(400); }],
    ['settings', () => baseSave(), async (p) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(300); await p.locator('.top button.icon').nth(1).click(); await p.waitForTimeout(400); }],
    ['pin', () => baseSave(), async (p) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(300); for (let i = 0; i < 5; i++) await p.locator('.top .logo').click(); await p.waitForTimeout(400); }],
    ['admin', () => baseSave(), async (p) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(300); for (let i = 0; i < 5; i++) await p.locator('.top .logo').click(); for (const k of '1958') await p.locator('.keys button', { hasText: new RegExp(`^${k}$`) }).click(); await p.waitForTimeout(400); }],
    ['drawing', () => baseSave(), async (p) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(300); await p.locator('button.play').click(); await p.waitForTimeout(9000); }],
    ['extraOffer', () => roundNearBingo(30), async (p) => { await p.getByText('ENTRAR').click(); await p.waitForSelector('text=BOLA EXTRA', { timeout: 8000 }); await p.waitForTimeout(500); }],
    ['bingo-celebration', () => roundNearBingo(29), async (p) => { await p.getByText('ENTRAR').click(); await p.waitForSelector('text=TERMINAR', { timeout: 20000 }); await p.getByRole('button', { name: /TERMINAR/ }).click(); await p.waitForSelector('text=CONTINUAR', { timeout: 20000 }); await p.waitForTimeout(1800); }],
    ['gift', () => { const s = baseSave(); s.credits = 20; return s; }, async (p) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(300); await p.locator('button.play').click(); await p.waitForSelector('text=PEGAR'); await p.waitForTimeout(400); }],
    ['muito-grande-idle', () => { const s = baseSave(); s.settings.textSize = 'muito'; return s; }, async (p) => { await p.getByText('ENTRAR').click(); await p.waitForTimeout(400); }],
    ['muito-grande-extra', () => { const s = roundNearBingo(30); s.settings.textSize = 'muito'; return s; }, async (p) => { await p.getByText('ENTRAR').click(); await p.waitForSelector('text=BOLA EXTRA', { timeout: 8000 }); await p.waitForTimeout(500); }],
  ];
  for (const vp of VIEWPORTS) {
    for (const [name, mk, run] of states) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      const errs: string[] = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      await seed(page, mk());
      await page.goto(BASE + '/');
      try { await run(page); } catch (e) { all.push(`[${vp.w}x${vp.h} ${name}] FALHA ao forçar estado: ${String(e).split('\n')[0]}`); }
      const res = await audit(page, `${vp.w}x${vp.h} ${name}`);
      all.push(...res);
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/${name}-${vp.w}x${vp.h}.png` });
      if (errs.length) all.push(`[${vp.w}x${vp.h} ${name}] ERROS JS: ${errs.join(' | ')}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log(all.length ? all.join('\n') : 'OK sem violações');
})();
