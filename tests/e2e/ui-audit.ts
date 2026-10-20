// Auditoria da UI v2 com Playwright (Chromium local, sem `playwright install`).
// Uso: npx tsx tests/e2e/ui-audit.ts [cenario,cenario...] [--no-shots] [--ts=grande]
// Sobe o vite dev na porta 4190 (ou usa UI_BASE), abre /src/ui/dev.html?s=<cenario> em 5 viewports,
// salva docs/qa/v2-<cenario>-<WxH>.png e audita: rolagem, alvos < 64 px, texto < 20 px, espaco < 12 px,
// dialogos com rolagem, textos cortados e sobreposicao entre regioes.
import { chromium, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4190;
const BASE = process.env.UI_BASE ?? `http://localhost:${PORT}`;
const EXE = '/opt/pw-browsers/chromium';
const VIEWPORTS = [
  { w: 1280, h: 800 },
  { w: 800, h: 1280 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 360, h: 740 },
];
const ALL = ['idle', 'drawing', 'extra', 'extra-free', 'mail-arrived', 'mail-open', 'bingo', 'bingo-cards', 'line', 'line-cards', 'gift', 'prizes', 'settings', 'pin', 'admin'];

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const names = args.filter((a) => !a.startsWith('--'))[0]?.split(',') ?? ALL;
const shots = !flags.includes('--no-shots');
const extraQuery = flags.filter((f) => f.startsWith('--q=')).map((f) => '&' + f.slice(4)).join('');

async function startServer(): Promise<ChildProcess | null> {
  if (process.env.UI_BASE) return null;
  const p = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/src/ui/dev.html`);
      if (r.ok) return p;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  p.kill();
  throw new Error('vite nao subiu');
}

async function audit(page: Page, label: string): Promise<string[]> {
  return page.evaluate((label) => {
    const out: string[] = [];
    const vw = innerWidth, vh = innerHeight;
    const de = document.documentElement;
    if (de.scrollHeight > vh + 1 || de.scrollWidth > vw + 1) out.push(`ROLAGEM doc ${de.scrollWidth}x${de.scrollHeight} > ${vw}x${vh}`);
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
        // vizinhos: sobrepoem-se num eixo e a distancia no outro e < 12
        const gap = dx >= 0 && dy < 0 ? dx : dy >= 0 && dx < 0 ? dy : dx < 0 && dy < 0 ? -1 : Math.hypot(dx, dy);
        if (gap < 11.5 && (gap >= 0 || (dx < 0 && dy < 0)))
          out.push(`ESPACO ${Math.round(gap)}px entre "${nm(a)}" e "${nm(b)}"`);
      }
    // texto < 20 px
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
    // dialogos: nada de rolagem; FECHAR/rodape visivel
    document.querySelectorAll<HTMLElement>('.layer:not(.hide) .dlg').forEach((d) => {
      const body = d.querySelector<HTMLElement>('.dlg-body');
      if (body && body.scrollHeight > body.clientHeight + 1) out.push(`DIALOGO COM ROLAGEM ${body.scrollHeight}>${body.clientHeight} (${d.getAttribute('aria-label')})`);
      if (d.scrollHeight > d.clientHeight + 1) out.push(`DIALOGO ESTOURA ${d.scrollHeight}>${d.clientHeight}`);
      const f = d.querySelector<HTMLElement>('.dlg-foot button');
      if (f) { const r = f.getBoundingClientRect(); if (r.bottom > vh || r.top < 0) out.push(`RODAPE FORA "${nm(f)}"`); }
    });
    // textos cortados
    document.querySelectorAll<HTMLElement>('.stat .val, .stat .lab, .sbox .l1, .sbox .l2, .tc, .pr .nm, .pr .pv, .btn, .counter, .seal .st, .xtitle, .falta, .mailb .ml, .caption').forEach((e) => {
      if (!vis(e)) return;
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') out.push(`CORTE-H "${nm(e)}" ${e.scrollWidth}>${e.clientWidth} .${e.className}`);
      if (e.scrollHeight > e.clientHeight + 2 && e.closest('.btn,.stat,.pr,.xpanel,.counter')) out.push(`CORTE-V "${nm(e)}" ${e.scrollHeight}>${e.clientHeight} .${e.className}`);
    });
    // celulas das cartelas com altura menor que o texto
    document.querySelectorAll<HTMLElement>('.card:not(.off) .cell').forEach((c, i) => {
      if (i > 14) return;
      const r = c.getBoundingClientRect();
      if (vis(c) && r.height < 21) out.push(`CELULA baixa ${Math.round(r.height)}px`);
    });
    // regioes principais nao podem se sobrepor
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

async function main(): Promise<void> {
  const srv = await startServer();
  mkdirSync('docs/qa', { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  let problems = 0;
  try {
    for (const v of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => { problems++; console.log(`PAGEERROR ${e.message}`); });
      for (const name of names) {
        const tsq = flags.find((f) => f.startsWith('--ts='))?.slice(5);
        await page.goto(`${BASE}/src/ui/dev.html?s=${name}${tsq ? `&ts=${tsq}` : ''}${extraQuery}`, { waitUntil: 'load' });
        await page.waitForTimeout(450);
        const label = `${name} ${v.w}x${v.h}`;
        const res = await audit(page, label);
        if (shots) await page.screenshot({ path: `docs/qa/v2-${name}-${v.w}x${v.h}.png` });
        problems += res.length;
        for (const r of res) console.log(r);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv?.kill();
  }
  console.log(problems ? `\n${problems} problema(s)` : '\nOK: nenhum problema');
  process.exit(problems ? 1 : 0);
}
void main();
