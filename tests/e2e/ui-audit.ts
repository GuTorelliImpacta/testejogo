// Auditoria da UI v3 com Playwright (Chromium local, sem `playwright install`).
// Uso: npx tsx tests/e2e/ui-audit.ts [cenario,cenario...] [--shots] [--ts=grande|muito] [--vp=WxH,WxH]
// Sobe o vite dev na porta 4190 (ou usa UI_BASE), abre /src/ui/dev.html?s=<cenario> em 25 viewports (docs/SPEC-v3 1.5),
// (--shots salva docs/qa/v3-depois-<cenario>-<WxH>.png so de tablets deitados e 3 celulares) e audita: rolagem, alvos < 64 px, texto < 20 px, espaco < 12 px,
// dialogos com rolagem, textos cortados e sobreposicao entre regioes.
import { chromium, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4191;
const BASE = process.env.UI_BASE ?? `http://127.0.0.1:${PORT}`;
const EXE = '/opt/pw-browsers/chromium';
const VIEWPORTS = (
  '1280x800,800x1280,1024x768,768x1024,960x600,600x960,1024x600,600x1024,1280x720,1366x768,1180x820,820x1180,1366x1024,1920x1080,1920x1200,' +
  '360x740,375x667,390x844,412x915,430x932,740x360,667x375,844x390,915x412,932x430'
)
  .split(',')
  .map((s) => { const [w, h] = s.split('x').map(Number); return { w, h }; });
const ALL = [
  'idle', 'mail-arrived', 'mail-open', 'drawing', 'drawing-turbo', 'extra', 'extra-free', 'bingo', 'bingo-cards', 'line', 'line-cards', 'gift', 'daily',
  'prizes', 'prizes-variado', 'settings', 'settings-jogo', 'settings-tela', 'pin', 'admin', 'admin-jogo', 'admin-jogo-2', 'admin-jogo-3', 'admin-jogo-4', 'admin-jogo-5', 'admin-resumo-2', 'admin-resumo-3', 'admin-resumo-4',
  'admin-pin', 'admin-pin-2', 'admin-pin-3', 'admin-aparelho', 'admin-aparelho-2', 'admin-aparelho-3', 'admin-aparelho-4', 'settings-admin', 'idle-variado', 'idle-big', 'extra-big', 'drawing-big',
];
/** screenshots "depois" (so com --shots): tablets deitados + 3 celulares, em 4 cenarios */
const SHOT_VP = new Set(['960x600', '1024x600', '1280x720', '1280x800', '1366x768', '1920x1200', '844x390', '360x740', '375x667']);
const SHOT_NAMES = new Set(['idle', 'drawing', 'extra', 'admin']);

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const names = args.filter((a) => !a.startsWith('--'))[0]?.split(',') ?? ALL;
const shots = flags.includes('--shots');
const only = flags.find((f) => f.startsWith('--vp='))?.slice(5).split(',');
const extraQuery = flags.filter((f) => f.startsWith('--q=')).map((f) => '&' + f.slice(4)).join('');

async function startServer(): Promise<ChildProcess | null> {
  if (process.env.UI_BASE) return null;
  const p = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
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
    let minCell = 999;
    document.querySelectorAll<HTMLElement>('.card:not(.off) .cell').forEach((c) => { if (vis(c)) minCell = Math.min(minCell, c.getBoundingClientRect().height); });
    if (minCell < 19.5) out.push(`CELULA baixa ${Math.round(minCell)}px (min)`);
    // v3: tudo visivel e tocavel sem rolar (so quando nao ha dialogo aberto)
    if (!document.querySelector('.layer:not(.hide)') && !document.querySelector('.splash:not(.hide)')) {
      const need = ['.logo', '.cred', '.jack', '.snd', '.gear', '.g-bet', '.g-cards', '.g-nums', '.g-turbo', '.g-play'];
      const xOn = document.querySelector('.altina.x-on');
      if (xOn) need.push('.xpanel', '.xbuy', '.xend'); else need.push('.counter', '.ptab');
      if (!xOn) need.push('.strip, .trail');
      for (const sel of need) {
        const list = [...document.querySelectorAll(sel)].filter(vis);
        if (!list.length) out.push(`AUSENTE ${sel}`);
        else for (const e of list) { const r = e.getBoundingClientRect(); if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) out.push(`FORA DA TELA ${sel}`); }
      }
      if (document.querySelectorAll('.card')?.length !== 4 || [...document.querySelectorAll('.card')].some((c) => !vis(c))) out.push('AUSENTE 4 cartelas');
    }
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
      if (only && !only.includes(`${v.w}x${v.h}`)) continue;
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.addInitScript('window.__name = (f) => f;');
      page.on('pageerror', (e) => { problems++; console.log(`PAGEERROR ${e.message}`); });
      for (const name of names) {
        const tsq = flags.find((f) => f.startsWith('--ts='))?.slice(5);
        const base = name.replace(/-(big|variado)$/, '');
        const mod = name.endsWith('-big') ? '&big=1' : name.endsWith('-variado') ? '&set=variado' : '';
        await page.goto(`${BASE}/src/ui/dev.html?s=${base}${mod}${tsq ? `&ts=${tsq}` : ''}${extraQuery}`, { waitUntil: 'load' });
        await page.waitForTimeout(450);
        const label = `${name} ${v.w}x${v.h}`;
        const res = await audit(page, label);
        if (shots && SHOT_NAMES.has(name) && SHOT_VP.has(`${v.w}x${v.h}`)) await page.screenshot({ path: `docs/qa/v3-depois-${name}-${v.w}x${v.h}.png` });
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
