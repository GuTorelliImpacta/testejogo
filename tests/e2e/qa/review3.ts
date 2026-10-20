// QA v3 (revisor): acesso ao painel, controles 2.3, PIN, migração, export/import no APP REAL (QA_BASE).
// Uso: QA_BASE=http://localhost:4183 npx tsx tests/e2e/qa/review3.ts [acesso|painel|pin|migra]
import type { Page } from '@playwright/test';
import { BASE, KEY, KEY_V1, baseSave, blankRound, today } from './fixtures';
import { launch, open } from './browser';

const only = process.argv[2];
const K3 = 'altina-da-sorte:v3';
let fails = 0;
const ok = (c: boolean, msg: string) => { if (!c) fails++; console.log(`${c ? '[OK ]' : '[FALHA]'} ${msg}`); };
const sv = (p: Page) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), K3);
const vis = (p: Page, sel: string) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('.hide'); }, sel);
const enter = async (p: Page) => { const b = p.getByText('ENTRAR'); if (await b.isVisible().catch(() => false)) { await b.click(); await p.waitForTimeout(300); } };
const keys = async (p: Page, pin: string) => { for (const d of pin) { await p.locator('.layer:not(.hide) .keys button', { hasText: new RegExp(`^${d}$`) }).first().click(); await p.waitForTimeout(110); } await p.waitForTimeout(150); };
const pinOpen = (p: Page) => vis(p, '.pindlg');
const admOpen = (p: Page) => vis(p, '.adm');
const jsClick = (p: Page, sel: string, text: string) => p.evaluate(([s, t]) => { const b = [...document.querySelectorAll<HTMLElement>(s)].find((x) => (x.textContent || '').trim().startsWith(t)); if (!b) return false; b.click(); return true; }, [sel, text]);
async function closeAll(p: Page) { for (let i = 0; i < 3; i++) { if (await vis(p, '.layer:not(.hide)')) { await p.keyboard.press('Escape'); await p.waitForTimeout(120); } } }
async function unlock(p: Page, pin = '1958') { for (let i = 0; i < 5; i++) await p.locator('.logo').first().click({ delay: 10 }); await p.waitForTimeout(250); await keys(p, pin); await p.waitForTimeout(250); }

const VPS = [[844, 390], [667, 375], [360, 740], [960, 600], [1920, 1200], [1280, 800], [740, 360], [820, 1180], [932, 430]];

async function acesso(b: Awaited<ReturnType<typeof launch>>) {
  console.log('\n== (2) acesso ao painel');
  for (const [w, h] of VPS) {
    const c = await open(b, baseSave(1), { width: w, height: h });
    const p = c.page; await enter(p);
    const rot = await p.evaluate(() => /vire|gire|em pé/i.test(document.body.innerText) || !!document.getElementById('rotate'));
    const logoVis = await vis(p, '.logo');
    for (let i = 0; i < 5; i++) await p.locator('.logo').first().click({ delay: 10 });
    await p.waitForTimeout(250);
    const viaLogo = await pinOpen(p);
    await keys(p, '1958');
    const admVia = await admOpen(p);
    await closeAll(p);
    await p.locator('.gear').first().click(); await p.waitForTimeout(200);
    await jsClick(p, '.dlg .tab', 'Tela'); await p.waitForTimeout(100);
    const btnVis = await p.evaluate(() => { const e = [...document.querySelectorAll<HTMLElement>('button')].find((x) => /Painel do neto/.test(x.textContent || '')); if (!e) return false; const r = e.getBoundingClientRect(); return r.width >= 64 && r.height >= 64 && r.bottom <= innerHeight && r.right <= innerWidth && r.top >= 0; });
    await jsClick(p, 'button', 'Painel do neto'); await p.waitForTimeout(250);
    const viaSet = await pinOpen(p);
    await keys(p, '1958');
    const admVia2 = await admOpen(p);
    ok(!rot && logoVis && viaLogo && admVia && btnVis && viaSet && admVia2 && !c.errs.length, `${w}x${h} semAvisoGirar=${!rot} logo=${logoVis} 5toques->PIN=${viaLogo}->painel=${admVia} botaoAjustes(>=64,na tela)=${btnVis} ->PIN=${viaSet}->painel=${admVia2} erros=${c.errs.length}`);
    if (w === 844 && h === 390) await p.screenshot({ path: 'docs/qa/review3-painel-844x390.png' });
    await c.ctx.close();
  }
}

const OPTS: [string, string, string][] = [ // [rótulo do grupo, valor (data-val), chave]
  ['Bingos por mês', '3-4', 'bingosPorMes'], ['Prêmios', 'mais', 'premiosDoDia'], ['Bola extra', 'mais', 'ofertaExtra'],
  ['grátis', 'menos', 'chanceGratis'], ['Custo', 'barata', 'custoExtra'], ['Presente', '2000', 'presente'], ['correio', '500', 'correioDiario'], ['padrões', 'variado', 'conjuntoPadroes'],
];
async function painel(b: Awaited<ReturnType<typeof launch>>) {
  console.log('\n== (3) painel');
  for (const [w, h] of [[1280, 800], [844, 390], [360, 740]]) {
    const s = blankRound({ mainIdx: 3 });
    const c = await open(b, s, { width: w, height: h });
    const p = c.page; await enter(p); await p.waitForTimeout(500);
    const roundBefore = JSON.stringify((await sv(p))?.round?.plan);
    await unlock(p);
    ok(await admOpen(p), `${w}x${h} painel abriu`);
    // abas
    await jsClick(p, '.adm .tab', 'Jogo'); await p.waitForTimeout(100);
    const defs = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.adm .gbox')].map((g) => ({ l: g.querySelector('h3')?.textContent || '', vals: [...g.querySelectorAll<HTMLElement>('.opt')].map((o) => o.dataset.val || '') })));
    ok(defs.length === 8, `${w}x${h} 8 grupos de controles (${defs.map((d) => d.l).join(' | ')})`);
    for (const [lab, val, key] of OPTS) {
      const done = await p.evaluate(([l, v]) => { const g = [...document.querySelectorAll<HTMLElement>('.adm .gbox')].find((x) => (x.querySelector('h3')?.textContent || '').toLowerCase().includes((l as string).toLowerCase())); const o = g && [...g.querySelectorAll<HTMLElement>('.opt')].find((x) => x.dataset.val === v); if (!o) return false; o.click(); return true; }, [lab, val]);
      await p.waitForTimeout(80);
      const t = (await sv(p))?.tuning;
      ok(done && String(t?.[key]) === val, `${w}x${h} ${key}=${val} -> salvo ${t?.[key]}`);
    }
    const roundAfter = JSON.stringify((await sv(p))?.round?.plan);
    ok(roundBefore === roundAfter && roundAfter !== undefined, `${w}x${h} rodada em andamento intacta (plano igual)`);
    const noteTxt = await p.evaluate(() => document.querySelector('.adm .anote')?.textContent || '');
    ok(/próxima rodada/i.test(noteTxt), `${w}x${h} aviso "vale na próxima rodada": "${noteTxt}"`);
    // resumo/estatísticas legíveis
    await jsClick(p, '.adm .tab', 'Resumo'); await p.waitForTimeout(150);
    const resumo = await p.evaluate(() => (document.querySelector('.adm')as HTMLElement).innerText.replace(/\s+/g, ' '));
    ok(!/[{}"]/.test(resumo) && /Rodadas|Bingo/i.test(resumo), `${w}x${h} resumo legível sem JSON: ${resumo.slice(0, 160)}`);
    // aparelho
    await jsClick(p, '.adm .tab', 'Aparelho'); await p.waitForTimeout(150);
    const ap = await p.evaluate(() => (document.querySelector('.adm')as HTMLElement).innerText.replace(/\s+/g, ' '));
    ok(/Tela/.test(ap) && /Janela/.test(ap) && !/undefined|NaN/.test(ap), `${w}x${h} aba Aparelho: ${ap.slice(0, 200)}`);
    // export contém tuning + pin
    const exp = await p.evaluate(() => (window as any).__qaExport ?? null);
    void exp;
    // recarrega
    await p.reload(); await enter(p); await p.waitForTimeout(400);
    let t = (await sv(p))?.tuning;
    ok(t?.bingosPorMes === '3-4' && t?.conjuntoPadroes === 'variado' && t?.presente === 2000 && t?.custoExtra === 'barata', `${w}x${h} persistiu após recarregar ${JSON.stringify(t)}`);
    await unlock(p); await jsClick(p, '.adm .tab', 'Jogo'); await p.waitForTimeout(100);
    const pressed = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.adm .opt[aria-pressed="true"]')].map((o) => o.dataset.val));
    ok(pressed.includes('3-4') && pressed.includes('variado'), `${w}x${h} botões refletem config após recarregar (${pressed.join(',')})`);
    // restaurar padrão (2 toques)
    await jsClick(p, '.adm .opt', 'Restaurar'); await p.waitForTimeout(400);
    t = (await sv(p))?.tuning; ok(t?.bingosPorMes === '3-4', `${w}x${h} 1º toque em Restaurar não restaura (pede confirmação)`);
    await jsClick(p, '.adm .opt', 'Toque de novo'); await p.waitForTimeout(150);
    t = (await sv(p))?.tuning;
    ok(t?.bingosPorMes === '2-3' && t?.premiosDoDia === 'normal' && t?.presente === 1000 && t?.correioDiario === 300 && t?.custoExtra === 'normal' && t?.conjuntoPadroes === 'classico', `${w}x${h} Restaurar padrão ${JSON.stringify(t)}`);
    // export/import: muda, exporta, zera, importa
    await jsClick(p, '.adm .opt', '3 a 4'); await p.waitForTimeout(80);
    if (w === 1280) {
      await jsClick(p, '.adm .tab', 'PIN');
      const json = await p.evaluate(() => (window as any).__api?.admin?.exportJson?.() ?? null);
      void json;
    }
    await c.ctx.close();
  }
  // export/import real: por navegador, interceptando clipboard/download
  const c = await open(b, blankRound(), { width: 1280, height: 800 }); const p = c.page;
  await c.ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await enter(p); await unlock(p);
  await jsClick(p, '.adm .tab', 'Jogo'); await jsClick(p, '.adm .opt', '3 a 4'); await p.waitForTimeout(100);
  await jsClick(p, '.adm .tab', 'PIN'); await p.waitForTimeout(100);
  await keys(p, '1958'); await keys(p, '2468'); await keys(p, '2468'); await p.waitForTimeout(200);
  const pm = await p.evaluate(() => document.querySelector('.adm .pint')?.textContent);
  ok(/trocado/i.test(pm || ''), `PIN trocado pela UI: "${pm}"`);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 4000 }).catch(() => null), (async () => { await jsClick(p, '.adm .tab', 'Aparelho'); await p.waitForTimeout(100); await jsClick(p, '.adm .opt', 'Exportar'); })()]);
  let json = '';
  if (dl) { const fs = await import('node:fs'); json = fs.readFileSync(await dl.path()!, 'utf8'); }
  const ex = json ? JSON.parse(json) : null;
  ok(!!ex && ex.tuning?.bingosPorMes === '3-4' && ex.adminPin === '2468' && ex.version === 3, `export traz tuning + PIN trocado + version 3 (download=${!!dl})`);
  // zera tudo e importa em "outro tablet"
  const c2 = await open(b, null, { width: 1280, height: 800 }); const p2 = c2.page; await enter(p2); await unlock(p2);
  await jsClick(p2, '.adm .tab', 'Aparelho'); await p2.waitForTimeout(100);
  await p2.evaluate((j) => { const t = document.querySelector<HTMLTextAreaElement>('.adm textarea')!; t.value = j; t.dispatchEvent(new Event('input', { bubbles: true })); }, json);
  await jsClick(p2, '.adm .opt', 'Importar'); await p2.waitForTimeout(250);
  const s2 = await sv(p2);
  ok(s2?.tuning?.bingosPorMes === '3-4' && s2?.adminPin === '2468', `import em outro aparelho aplicou tuning+PIN (${s2?.tuning?.bingosPorMes}, pin=${s2?.adminPin})`);
  await c2.ctx.close(); await c.ctx.close();
}

async function pinTests(b: Awaited<ReturnType<typeof launch>>) {
  console.log('\n== (4) PIN');
  const c = await open(b, baseSave(1), { width: 1280, height: 800 }); const p = c.page; await enter(p);
  await unlock(p, '0000'); ok(!(await admOpen(p)), 'PIN errado não abre'); await closeAll(p);
  await unlock(p); ok(await admOpen(p), 'PIN padrão 1958 abre');
  await jsClick(p, '.adm .tab', 'Resumo'); await p.waitForTimeout(400); await jsClick(p, '.adm .tab', 'PIN'); await p.waitForTimeout(400); console.log('  titulo inicial:', await p.evaluate(() => document.querySelector('.adm .pint')?.textContent)); await keys(p, '1111'); await keys(p, '2468'); await keys(p, '2468'); await p.waitForTimeout(200);
  ok(/não|incorret|errad/i.test((await p.evaluate(() => document.querySelector('.adm .pint')?.textContent)) || ''), 'trocar com PIN antigo errado é recusado');
  await keys(p, '1958'); await keys(p, '2468'); await keys(p, '2469'); await p.waitForTimeout(150);
  ok(/igua|conferem|diferent/i.test((await p.evaluate(() => document.querySelector('.adm .pint')?.textContent)) || '') , 'confirmação diferente é recusada: ' + (await p.evaluate(() => document.querySelector('.adm .pint')?.textContent)));
  await keys(p, '2468'); await keys(p, '2468'); await p.waitForTimeout(150);
  ok(/trocado/i.test((await p.evaluate(() => document.querySelector('.adm .pint')?.textContent)) || ''), 'PIN trocado para 2468');
  await closeAll(p);
  await unlock(p, '1958'); ok(!(await admOpen(p)), 'PIN antigo 1958 deixou de valer'); await closeAll(p);
  await unlock(p, '2468'); ok(await admOpen(p), 'PIN novo 2468 abre'); await closeAll(p);
  // nunca em claro
  const leak = await p.evaluate(() => ({ dom: document.documentElement.innerHTML.includes('2468') || document.documentElement.innerHTML.includes('1958'), txt: document.body.innerText.includes('2468') }));
  ok(!leak.dom, 'PIN não aparece no DOM (nem 1958 nem 2468) com painel fechado');
  await unlock(p, '2468');
  const leak2 = await p.evaluate(() => ({ dom: /2468|1958/.test(document.documentElement.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '')) , caps: ((window as any).__log?.caps || []).some((x: any) => /2468|1958/.test(x.text)), utter: ((window as any).__log?.utter || []).some((x: any) => /2468|1958/.test(x.text)) }));
  ok(!leak2.dom && !leak2.caps && !leak2.utter, `PIN não aparece em DOM/legenda/voz com painel aberto ${JSON.stringify(leak2)}`);
  for (const tab of ['Resumo', 'Jogo', 'PIN', 'Aparelho']) { await jsClick(p, '.adm .tab', tab); await p.waitForTimeout(80); const t = await p.evaluate(() => document.querySelector<HTMLElement>('.adm')!.innerText); if (/2468|1958/.test(t)) ok(false, 'PIN visível na aba ' + tab); }
  ok(true, 'texto visível das 4 abas sem PIN');
  // reset via URL
  await c.ctx.close();
  const c3 = await open(b, null, { width: 1280, height: 800, goto: false });
  const p3 = c3.page; const dialogs: string[] = [];
  await p3.goto(BASE + '/'); await enter(p3); await unlock(p3);
  await jsClick(p3, '.adm .tab', 'PIN'); await keys(p3, '1958'); await keys(p3, '2468'); await keys(p3, '2468'); await p3.waitForTimeout(150);
  p3.on('dialog', async (d) => { dialogs.push(d.type() + ':' + d.message()); await d.accept('1958'); });
  await p3.goto(BASE + '/?resetpin=1'); await p3.waitForTimeout(600);
  ok(dialogs.length === 1 && dialogs[0].startsWith('prompt'), 'resetpin pede o PIN via prompt: ' + dialogs.join('|'));
  ok(!dialogs.join().match(/1958|2468/), 'prompt não revela o PIN');
  ok((await sv(p3))?.adminPin == null, 'após ?resetpin=1 adminPin=null');
  ok(!(await p3.url()).includes('resetpin'), 'URL limpa depois: ' + p3.url());
  await enter(p3); await unlock(p3, '1958'); ok(await admOpen(p3), 'PIN padrão volta a abrir após reset');
  // reset com PIN errado
  await closeAll(p3);
  await jsClick(p3, '.gear', ''); await p3.close();
  const c4 = await open(b, null, { width: 1280, height: 800, goto: false }); const p4 = c4.page;
  await p4.goto(BASE + '/'); await enter(p4); await unlock(p4); await jsClick(p4, '.adm .tab', 'PIN'); await keys(p4, '1958'); await keys(p4, '2468'); await keys(p4, '2468');
  p4.on('dialog', async (d) => { await d.accept('0000'); });
  await p4.goto(BASE + '/?resetpin=1'); await p4.waitForTimeout(500);
  ok((await sv(p4))?.adminPin === '2468', 'reset com PIN padrão errado não altera o PIN'); 
  await c3.ctx.close(); await c4.ctx.close();
}

async function migra(b: Awaited<ReturnType<typeof launch>>) {
  console.log('\n== (5) migração');
  const v2 = blankRound({ mainIdx: 7, credits: 4321 }) as any;
  v2.version = 2; delete v2.tuning; delete v2.adminPin; v2.jackpot = 77777; v2.stats.rounds = 123; v2.settings.textSize = 'grande';
  const planBefore = JSON.stringify(v2.round.plan), cardsBefore = JSON.stringify(v2.cards);
  const c = await open(b, v2, { width: 1280, height: 800 }); const p = c.page; await enter(p); await p.waitForTimeout(600);
  const s = await sv(p);
  ok(s?.version === 3 && s.credits === 4321 && s.jackpot >= 77777 && s.stats.rounds === 123, `v2->v3 saldo/acumulado/stats (cred ${s?.credits}, jp ${s?.jackpot}, rounds ${s?.stats?.rounds})`);
  ok(JSON.stringify(s?.cards) === cardsBefore && s.settings.textSize === 'grande', 'cartelas e ajustes preservados');
  ok(s?.tuning?.bingosPorMes === '2-3' && s.adminPin == null, 'tuning padrão e PIN nulo adicionados');
  ok(!!s?.round && JSON.stringify(s.round.plan) === planBefore || s?.round === null, `rodada em andamento: ${s?.round ? 'preservada com plano igual=' + (JSON.stringify(s.round.plan) === planBefore) : 'concluída/continuada (round=null)'} mainIdx=${s?.round?.mainIdx}`);
  const cred = await p.evaluate(() => document.querySelector('.cred .val')?.textContent);
  console.log('   créditos na tela:', cred, 'erros:', c.errs.join(';') || 'nenhum');
  await p.waitForTimeout(25000);
  const s2 = await sv(p); ok(!c.errs.length, `rodada v2 seguiu sem erro; mainIdx agora ${s2?.round?.mainIdx ?? 'terminada'}`);
  await c.ctx.close();
  // v1
  const base = baseSave(3) as any; const v1: any = { version: 1, credits: 2468, jackpot: 9999, bet: 20, settings: base.settings, director: base.director, stats: { ...base.stats, rounds: 55 }, lastDailyBonus: today() };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem('s')) { localStorage.setItem(k as string, v as string); sessionStorage.setItem('s', '1'); } } catch {} }, [KEY_V1, JSON.stringify(v1)]);
  const p1 = await ctx.newPage(); const e1: string[] = []; p1.on('pageerror', (e) => e1.push(String(e))); await p1.goto(BASE + '/'); await enter(p1); await p1.waitForTimeout(600);
  const s1 = await sv(p1);
  ok(s1?.version === 3 && s1.credits === 2468 && s1.jackpot >= 9999 && s1.stats.rounds === 55 && s1.round === null && !e1.length, `v1->v3 saldo ${s1?.credits}, jp ${s1?.jackpot}, rounds ${s1?.stats?.rounds}, bet ${s1?.bet}, erros ${e1.length}`);
  await ctx.close();
}

(async () => {
  const b = await launch();
  if (!only || only === 'acesso') await acesso(b);
  if (!only || only === 'painel') await painel(b);
  if (!only || only === 'pin') await pinTests(b);
  if (!only || only === 'migra') await migra(b);
  await b.close();
  console.log(`\nFALHAS: ${fails}`);
  process.exit(fails ? 1 : 0);
})();
