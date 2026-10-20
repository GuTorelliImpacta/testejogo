// Utilitários de browser para os scripts de QA v2 (Playwright + Chromium local; nunca `playwright install`).
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE, EXE, KEY } from './fixtures';

/** Instrumentação injetada em toda página: timers, falas sintetizadas, legendas, AudioContext, requisições. */
export const INIT = `
window.__name = (f) => f;
window.__log = { intervals: 0, live: new Set(), utter: [], caps: [], ctxs: [], t0: performance.now() };
const _si = window.setInterval; window.setInterval = function(...a){ window.__log.intervals++; return _si.apply(this,a); };
const _st = window.setTimeout, _ct = window.clearTimeout;
window.setTimeout = function(fn, ms, ...r){ const id = _st.call(this, function(){ window.__log.live.delete(id); return typeof fn==='function'?fn(...r):0; }, ms); window.__log.live.add(id); return id; };
window.clearTimeout = function(id){ window.__log.live.delete(id); return _ct.call(this,id); };
try {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    window.AudioContext = class extends AC { constructor(...a){ super(...a); window.__log.ctxs.push(this); window.__ctx = this; } };
  }
} catch(e){}
try {
  const ss = window.speechSynthesis;
  if (ss) {
    ss.speak = function(u){ window.__log.utter.push({ t: Math.round(performance.now()-window.__log.t0), text: u.text }); setTimeout(() => { try { u.onend && u.onend(new Event('end')); } catch(e){} }, 350); };
    ss.cancel = function(){}; ss.getVoices = function(){ return []; };
  }
} catch(e){}
addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app');
  let last = '';
  new MutationObserver(() => {
    const c = document.querySelector('.caption');
    if (!c) return;
    const txt = c.textContent || '';
    const cls = c.className;
    const k = cls + '|' + txt;
    if (k === last) return; last = k;
    window.__log.caps.push({ t: Math.round(performance.now()-window.__log.t0), text: txt, spk: cls.includes('spk'), hot: cls.includes('hot'), on: cls.includes(' on') });
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
});
`;

export interface Ctx {
  ctx: BrowserContext;
  page: Page;
  errs: string[];
  bad: string[]; // respostas >= 400 / requestfailed
  reqs: string[]; // todas as URLs de áudio pedidas
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
}

/**
 * Abre página com o save injetado em localStorage (só na 1ª carga da sessão: reload preserva o que o jogo gravou).
 * `sw` = deixa o service worker valer (padrão: bloqueado).
 */
export async function open(
  browser: Browser,
  save: unknown | null,
  vp = { width: 1280, height: 800 },
  o: { sw?: boolean; reducedMotion?: boolean; url?: string; goto?: boolean } = {},
): Promise<Ctx> {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: o.sw ? 'allow' : 'block', reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(INIT);
  if (save)
    await ctx.addInitScript(
      ([k, v]) => {
        try {
          if (!sessionStorage.getItem('__qa_seeded')) {
            localStorage.setItem(k as string, v as string);
            sessionStorage.setItem('__qa_seeded', '1');
          }
        } catch {
          /* ignora */
        }
      },
      [KEY, JSON.stringify(save)],
    );
  const page = await ctx.newPage();
  const errs: string[] = [];
  const bad: string[] = [];
  const reqs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(BASE, '')}`);
    if (r.url().includes('/audio/')) reqs.push(`${r.status()} ${r.url().replace(BASE, '')}`);
  });
  page.on('requestfailed', (r) => bad.push(`FAILED ${r.url().replace(BASE, '')}`));
  if (o.goto !== false) await page.goto((o.url ?? BASE) + '/');
  return { ctx, page, errs, bad, reqs };
}

export const saved = (p: Page) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
export const credits = (p: Page) => p.evaluate(() => (document.querySelector('.cred .val')?.textContent || '').replace(/\./g, ''));
export const enter = async (p: Page) => {
  await p.getByText('ENTRAR').click();
  await p.waitForTimeout(250);
};
export const log = (p: Page) =>
  p.evaluate(() => {
    const l = (window as any).__log;
    return { utter: l.utter as { t: number; text: string }[], caps: l.caps as { t: number; text: string; spk: boolean; hot: boolean; on: boolean }[], intervals: l.intervals as number, live: l.live.size as number };
  });

/** Termina a rodada tratando oferta/celebração/presente. `buy` = compra extras em vez de TERMINAR. */
export async function finishRound(p: Page, timeout = 150_000, opts: { buy?: boolean } = {}) {
  const t0 = Date.now();
  const seen: string[] = [];
  while (Date.now() - t0 < timeout) {
    const term = p.getByRole('button', { name: /TERMINAR/ });
    const buy = p.locator('.xbuy');
    const cont = p.getByRole('button', { name: /CONTINUAR/ });
    const gift = p.getByRole('button', { name: /PEGAR/ });
    if (await buy.isVisible().catch(() => false)) {
      seen.push('oferta');
      if (opts.buy) await buy.click();
      else await term.click();
    } else if (await cont.isVisible().catch(() => false)) {
      seen.push('celebracao');
      await cont.click();
    } else if (await gift.isVisible().catch(() => false)) {
      seen.push('presente');
      await gift.click();
    } else if (await p.locator('button.play').isEnabled().catch(() => false)) return { ok: true, seen };
    await p.waitForTimeout(200);
  }
  return { ok: false, seen };
}

/** Auditoria de layout no estado atual da página: rolagem, alvos, texto, espaçamento, diálogos, cortes, sobreposição. */
export async function audit(page: Page, label: string): Promise<string[]> {
  return page.evaluate((label) => {
    const out: string[] = [];
    const vw = innerWidth, vh = innerHeight;
    const de = document.documentElement;
    if (de.scrollHeight > vh + 1 || de.scrollWidth > vw + 1 || document.body.scrollHeight > vh + 1) out.push(`ROLAGEM doc ${de.scrollWidth}x${de.scrollHeight} > ${vw}x${vh}`);
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      for (let p: Element | null = e; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return true;
    };
    const nm = (b: Element) => (b.textContent || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 22);
    const topmost = (e: Element) => {
      const r = e.getBoundingClientRect();
      const t = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
      return !!t && (e === t || e.contains(t) || t.contains(e));
    };
    const btns = [...document.querySelectorAll('button, textarea')].filter(vis).filter(topmost);
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (r.width < 63.5 || r.height < 63.5) out.push(`ALVO ${Math.round(r.width)}x${Math.round(r.height)} "${nm(b)}" .${(b as HTMLElement).className}`);
      if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) out.push(`FORA DA TELA "${nm(b)}" ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    for (let i = 0; i < btns.length; i++)
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i], b = btns[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const dx = Math.max(ra.left - rb.right, rb.left - ra.right);
        const dy = Math.max(ra.top - rb.bottom, rb.top - ra.bottom);
        const gap = dx >= 0 && dy < 0 ? dx : dy >= 0 && dx < 0 ? dy : dx < 0 && dy < 0 ? -1 : Math.hypot(dx, dy);
        if (gap < 11.5 && (gap >= 0 || (dx < 0 && dy < 0))) out.push(`ESPACO ${Math.round(gap)}px entre "${nm(a)}" e "${nm(b)}"`);
      }
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = (n.textContent || '').trim();
      if (!t) continue;
      const el = n.parentElement!;
      if (el.closest('.sr, noscript, script, style, pre')) continue;
      if (!vis(el) || getComputedStyle(el).opacity === '0') continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 19.99) {
        const k = `${el.className}|${t.slice(0, 20)}`;
        if (!seen.has(k)) { seen.add(k); out.push(`TEXTO ${fs}px "${t.slice(0, 24)}" .${el.className}`); }
      }
    }
    document.querySelectorAll<HTMLElement>('.layer:not(.hide) .dlg').forEach((d) => {
      const body = d.querySelector<HTMLElement>('.dlg-body');
      if (body && body.scrollHeight > body.clientHeight + 1) out.push(`DIALOGO COM ROLAGEM ${body.scrollHeight}>${body.clientHeight} (${d.getAttribute('aria-label')})`);
      if (d.scrollHeight > d.clientHeight + 1) out.push(`DIALOGO ESTOURA ${d.scrollHeight}>${d.clientHeight}`);
      const f = d.querySelector<HTMLElement>('.dlg-foot button');
      if (f) { const r = f.getBoundingClientRect(); if (r.bottom > vh + 0.5 || r.top < 0) out.push(`RODAPE FORA "${nm(f)}"`); }
    });
    document.querySelectorAll<HTMLElement>('.stat .val, .stat .lab, .sbox .l1, .sbox .l2, .tc, .pr .nm, .pr .pv, .btn, .counter, .seal .st, .xtitle, .falta, .mailb .ml, .caption, .bigprize, .dlg h2').forEach((e) => {
      if (!vis(e)) return;
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') out.push(`CORTE-H "${nm(e)}" ${e.scrollWidth}>${e.clientWidth} .${e.className}`);
      if (e.scrollHeight > e.clientHeight + 2 && e.closest('.btn,.stat,.pr,.xpanel,.counter')) out.push(`CORTE-V "${nm(e)}" ${e.scrollHeight}>${e.clientHeight} .${e.className}`);
    });
    let minCell = 999;
    document.querySelectorAll<HTMLElement>('.card:not(.off) .cell').forEach((c) => { if (vis(c)) minCell = Math.min(minCell, c.getBoundingClientRect().height); });
    if (minCell < 19.5) out.push(`CELULA baixa ${Math.round(minCell)}px (min)`);
    const regs = ['.top', '.ballsec', '.xpanel', '.strip', '.trail', '.ptab', '.cards', '.bar', '.capslot'].map((s) => [s, document.querySelector(s)] as const)
      .filter(([, e]) => e && vis(e)).map(([s, e]) => [s, e!.getBoundingClientRect()] as const);
    for (let i = 0; i < regs.length; i++)
      for (let j = i + 1; j < regs.length; j++) {
        const a = regs[i][1], b = regs[j][1];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`SOBREPOSTO ${regs[i][0]} x ${regs[j][0]}`);
      }
    for (const [s, r] of regs) if (r.bottom > vh + 1 || r.right > vw + 1) out.push(`REGIAO FORA ${s} ${Math.round(r.right)}x${Math.round(r.bottom)}`);
    return out.map((o) => `[${label}] ${o}`);
  }, label);
}
