// QA v2: fluxos no APP REAL (build de produção em QA_BASE, padrão http://localhost:4181) com estados forçados via localStorage.
// Uso: npx tsx tests/e2e/qa/flows.ts [secao,secao]   (sem argumento = tudo)
import { writeFileSync } from 'node:fs';
import { BASE, KEY, VIEWPORTS, baseSave, blankRound, fillers, mkPlan, nearBingo, nearDouble, today, withRound } from './fixtures';
import { audit, credits, enter, finishRound, launch, log, open, saved } from './browser';
import { LINE_BY_ID, VOICE_LINES } from '../../../src/audio/script';

const want = process.argv[2]?.split(',');
const on = (k: string) => !want || want.includes(k);
let fails = 0;
const out: string[] = [];
const chk = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  const l = `${ok ? 'OK   ' : 'FALHA'} ${name}${info ? ' -> ' + info : ''}`;
  out.push(l);
  console.log(l);
};
const note = (s: string) => { out.push('     ' + s); console.log('     ' + s); };
const allBad: string[] = [];
const allErrs: string[] = [];

(async () => {
  const browser = await launch();

  // ------------------------------------------------------------------ 1) rodada completa em velocidade normal: 1 toque, legenda = fala, 0 404
  if (on('normal')) {
    const c = await open(browser, baseSave(7));
    const { page: p } = c;
    await enter(p);
    const v0 = await saved(p);
    await p.locator('button.play').click();
    const t0 = Date.now();
    const r = await finishRound(p, 170_000);
    const l = await log(p);
    chk('rodada completa com 1 toque (JOGAR)', r.ok, `${((Date.now() - t0) / 1000).toFixed(0)}s; eventos=${r.seen.join(',') || '-'}`);
    const spk = l.caps.filter((x) => x.spk).map((x) => x.text);
    const valid = new Set<string>();
    for (const ln of VOICE_LINES) valid.add(ln.text);
    const strange = spk.filter((t) => !valid.has(t));
    chk('M9: toda legenda "falada" (classe spk) é EXATAMENTE o texto de uma fala do roteiro', spk.length > 20 && strange.length === 0, `${spk.length} falas legendadas; fora do roteiro=${JSON.stringify(strange.slice(0, 5))}`);
    const hot = l.caps.filter((x) => x.hot).map((x) => x.text);
    note(`avisos visuais não falados (classe hot): ${[...new Set(hot)].join(' | ') || '-'}`);
    const nums = spk.filter((t) => /!$/.test(t));
    note(`primeiras legendas faladas: ${spk.slice(0, 10).join(' | ')}`);
    chk('nenhuma fala sintetizada (speechSynthesis) quando há clipes (voz = clipes pré-gravados)', l.utter.length === 0, `utter=${l.utter.length} ${JSON.stringify(l.utter.slice(0, 3))}`);
    chk('só a SAUDAÇÃO escapa do clipe? (utter limitado à saudação)', l.utter.every((u) => /Vamos jogar/.test(u.text)), JSON.stringify(l.utter.map((u) => u.text)));
    chk('0 setInterval durante a rodada', l.intervals === 0, `intervals=${l.intervals}`);
    const v1 = await saved(p);
    note(`créditos(save) ${v0.credits} -> ${v1.credits}; rodadas=${v1.stats.rodadas}`);
    await p.waitForTimeout(3500);
    const idle = await p.evaluate(() => ({ live: (window as any).__log.live.size, anims: document.getAnimations().length, confetti: document.querySelectorAll('.confetti').length }));
    chk('ocioso após a rodada: animações CSS/WAAPI ativas = 0, confete = 0', idle.anims === 0 && idle.confetti === 0, JSON.stringify(idle));
    note(`timeouts vivos em repouso: ${idle.live} (vazamento se crescer rodada a rodada)`);
    const aud = c.reqs;
    chk('M4/A5: nenhuma requisição de áudio 404 / falha', c.bad.filter((b) => /audio|sfx|voice/.test(b)).length === 0 && c.bad.length === 0, `requisições de áudio=${aud.length}; ruins=${JSON.stringify(c.bad)}`);
    chk('erros JS = 0', c.errs.length === 0, JSON.stringify(c.errs));
    allBad.push(...c.bad); allErrs.push(...c.errs);
    await c.ctx.close();
  }

  // ------------------------------------------------------------------ 2) Turbo antes da rodada: ritmo, voz só nos prêmios
  if (on('turbo')) {
    // cartela 0 faz uma Linha na bola 10 (e nada mais): prêmio narrado, números calados
    const s = baseSave(2);
    const c0 = s.cards[0].nums;
    s.settings.turbo = false;
    const plan = mkPlan(s.cards, { early: [...c0.slice(0, 4), ...fillers(s.cards, 5), c0[4]] });
    const c = await open(browser, withRound(s, plan, { mainIdx: 0, credits: 980 }));
    const { page: p } = c;
    await p.evaluate(() => {
      // registra o ritmo: instante em que cada casa do trilho é preenchida
      const w = window as any; w.__tick = [];
      new MutationObserver(() => { const n = document.querySelectorAll('.trail .tr-main .tc.on').length; const a = w.__tick; if (!a.length || a[a.length - 1].n !== n) a.push({ t: performance.now(), n }); }).observe(document.querySelector('.trail')!, { subtree: true, attributes: true, childList: true });
    });
    // liga o Turbo ANTES de entrar na rodada (via botão da barra) -- o save tem round, então primeiro ENTRAR retoma; usamos outro save p/ "antes"
    await c.ctx.close();

    const s2 = baseSave(2);
    const d0 = s2.cards[0].nums;
    const c2 = await open(browser, s2);
    const p2 = c2.page;
    await enter(p2);
    chk('botão Turbo existe, desligado por padrão', /Desligado/.test((await p2.locator('.g-turbo').textContent()) ?? ''));
    await p2.locator('.g-turbo').click();
    await p2.waitForTimeout(300);
    chk('Turbo ligado e salvo nas configurações', (await saved(p2)).settings.turbo === true && /Ligado/.test((await p2.locator('.g-turbo').textContent()) ?? ''));
    await p2.reload();
    await enter(p2);
    chk('Turbo persiste depois de recarregar', /Ligado/.test((await p2.locator('.g-turbo').textContent()) ?? ''));
    await p2.evaluate(() => {
      const w = window as any; w.__tick = [];
      new MutationObserver(() => { const n = document.querySelectorAll('.trail .tr-main .tc.on').length; const a = w.__tick; if (!a.length || a[a.length - 1].n !== n) a.push({ t: performance.now(), n }); }).observe(document.querySelector('.trail')!, { subtree: true, attributes: true, childList: true });
    });
    await p2.locator('button.play').click();
    const t0 = Date.now();
    const r = await finishRound(p2, 60_000);
    const tick: { t: number; n: number }[] = await p2.evaluate(() => (window as any).__tick);
    const gaps = tick.slice(1).map((x, i) => x.t - tick[i].t);
    const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    chk('Turbo ligado antes: 30 bolas em sequência rápida (mediana ~120 ms)', r.ok && tick.length >= 25 && med < 250, `mediana=${med?.toFixed(0)}ms, bolas vistas=${tick.length}, rodada ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const l2 = await log(p2);
    const spk2 = l2.caps.filter((x) => x.spk).map((x) => x.text);
    const cats = spk2.map((t) => VOICE_LINES.find((v) => v.text === t)?.category ?? '??');
    const bad = cats.filter((k) => ['number', 'bordao', 'almost'].includes(k));
    chk('Turbo: nenhuma fala de número/bordão/"falta 1" (só prêmios, oferta, comentários)', bad.length === 0, `falas=${JSON.stringify(spk2)} categorias=${cats.join(',')}`);
    chk('Turbo: sem speechSynthesis além da saudação inicial', l2.utter.every((u) => /Vamos jogar/.test(u.text)), JSON.stringify(l2.utter.slice(0, 3)));
    await c2.ctx.close();
    void d0;

    // Turbo com prêmio: Linha deve ser narrada
    const s3 = baseSave(2);
    const e0 = s3.cards[0].nums;
    s3.settings.turbo = true;
    const plan3 = mkPlan(s3.cards, { early: [...e0.slice(0, 4), ...fillers(s3.cards, 5), e0[4]] });
    const c3 = await open(browser, withRound(s3, plan3, { mainIdx: 0, credits: 980 }));
    await enter(c3.page);
    const r3 = await finishRound(c3.page, 40_000);
    const l3 = await log(c3.page);
    const spk3 = l3.caps.filter((x) => x.spk).map((x) => x.text);
    const cats3 = spk3.map((t) => VOICE_LINES.find((v) => v.text === t)?.category ?? '??');
    chk('Turbo: o prêmio (Linha) é narrado', r3.ok && cats3.includes('prize'), `falas=${JSON.stringify(spk3)}`);
    chk('Turbo: números continuam calados nessa rodada com prêmio', !cats3.some((k) => k === 'number'), cats3.join(','));
    await c3.ctx.close();
  }

  // ------------------------------------------------------------------ 3) Turbo no MEIO da rodada pela UI
  if (on('turbo-mid')) {
    const c = await open(browser, baseSave(3));
    const p = c.page;
    await enter(p);
    await p.locator('button.play').click();
    await p.evaluate(() => {
      const w = window as any; w.__tick = [];
      new MutationObserver(() => { const n = document.querySelectorAll('.trail .tr-main .tc.on').length; const a = w.__tick; if (!a.length || a[a.length - 1].n !== n) a.push({ t: performance.now(), n }); }).observe(document.querySelector('.trail')!, { subtree: true, attributes: true, childList: true });
    });
    await p.waitForFunction(() => document.querySelectorAll('.trail .tr-main .tc.on').length >= 3, null, { timeout: 30000 });
    const tOn = await p.evaluate(() => performance.now());
    await p.locator('.g-turbo').click();
    const r = await finishRound(p, 60_000);
    const tick: { t: number; n: number }[] = await p.evaluate(() => (window as any).__tick);
    const after = tick.filter((x) => x.t > tOn + 400);
    const gaps = after.slice(1).map((x, i) => x.t - after[i].t);
    const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    chk('Turbo ligado no MEIO da rodada: o resto cai rápido (mediana < 250 ms) e termina', r.ok && med < 250, `mediana=${med?.toFixed(0)}ms, n=${gaps.length}`);
    chk('Turbo no meio: botão Turbo habilitado durante o sorteio', true);
    await p.waitForTimeout(500);
    c.errs.length && note('erros: ' + c.errs.join(' | '));
    chk('Turbo no meio: sem erros JS', c.errs.length === 0);
    await c.ctx.close();
  }

  // ------------------------------------------------------------------ 4) bola extra grátis x paga no app real (saldo antes/depois)
  if (on('extra')) {
    for (const free of [true, false]) {
      const c = await open(browser, nearDouble({ free: [free], credits: 800, turbo: false }));
      const p = c.page;
      await enter(p);
      await p.waitForSelector('.xpanel:not(.hide)', { timeout: 20000 });
      const title = await p.locator('.xtitle').textContent();
      const buyTxt = await p.locator('.xbuy').textContent();
      chk(`oferta ${free ? 'GRÁTIS' : 'paga'}: título "${title}", botão "${buyTxt}"`, free ? /GRÁTIS/.test(title!) && /GRÁTIS/.test(buyTxt!) : /custa 10/.test(title!));
      const isGold = await p.evaluate(() => document.querySelector('.xpanel')!.classList.contains('free'));
      chk('classe "free" (destaque dourado) só na grátis', isGold === free);
      const faltas = await p.locator('.card .falta.on').allTextContents();
      note(`selos FALTA 1 (${free ? 'grátis' : 'paga'}): ${faltas.join(' | ')}`);
      chk('selo "FALTA 1 → Linha dupla: +125" na cartela', faltas.some((t) => /Linha dupla/.test(t) && /125/.test(t)), JSON.stringify(faltas));
      const cr0 = Number(await credits(p));
      const bottom = await p.evaluate(() => [...document.querySelectorAll('.xpanel button')].map((b) => b.textContent));
      await p.locator('.xbuy').click();
      await p.waitForTimeout(120);
      const cr1 = Number(await credits(p));
      chk(`saldo antes ${cr0}, logo depois de comprar ${cr1}: ${free ? 'NÃO debita' : 'debita 10'}`, free ? cr1 === cr0 : cr1 === cr0 - 10);
      const r = await finishRound(p, 60_000);
      await p.waitForTimeout(1600);
      const crEnd = Number(await credits(p));
      chk(`saldo final = ${cr0 - (free ? 0 : 10) + 125}`, crEnd === cr0 - (free ? 0 : 10) + 125, `final=${crEnd}`);
      const sv = await saved(p);
      note(`save: recargas=${sv.stats.recargas} apostadoTotal=${sv.stats.apostadoTotal}; botões do painel: ${bottom.join('/')}`);
      chk('oferta termina a rodada', r.ok);
      await c.ctx.close();
    }
    // até 9 extras: plano com 9 extras que não completam, todas grátis -> 9 compras e acaba
    {
      const s = nearBingo({ mainIdx: 30, credits: 3000, bet: 2, extrasDecisive: true, free: Array(9).fill(false), turbo: true });
      const f = fillers(s.cards, 30, 1);
      s.round!.plan.extras = f.slice(0, 9); // nenhuma decide
      const c = await open(browser, s);
      const p = c.page;
      await enter(p);
      let n = 0;
      const titles: string[] = [];
      for (let i = 0; i < 14; i++) {
        const vis = await p.locator('.xpanel:not(.hide)').isVisible().catch(() => false);
        if (!vis) { await p.waitForTimeout(250); if (await p.locator('button.play').isEnabled().catch(() => false)) break; continue; }
        titles.push((await p.locator('.counter').first().textContent()) + ' / ' + (await p.locator('.xrem').first().textContent().catch(() => '')));
        await p.locator('.xbuy').click();
        n++;
        await p.waitForTimeout(1300);
      }
      const r = await finishRound(p, 30_000);
      const sv = await saved(p);
      chk('9 extras compradas e depois NENHUMA oferta (limite 9)', n === 9 && r.ok, `compradas=${n}; contadores=${titles.slice(0, 3).join(' | ')} ... ${titles.slice(-1)}`);
      const filled = await p.evaluate(() => ({ main: document.querySelectorAll('.trail .tr-main .tc.on').length, extra: document.querySelectorAll('.trail .tr-extra .tc.on').length, counter: document.querySelector('.ballsec .counter')?.textContent }));
      chk('trilho: 30 principais + 9 extras acesas', filled.main === 30 && filled.extra === 9, JSON.stringify(filled));
      void sv;
      await c.ctx.close();
    }
  }

  // ------------------------------------------------------------------ 5) acumulado no app real (injetando plano e aposta)
  if (on('jackpot')) {
    for (const [bet, pct] of [[1, 0.5], [2, 0.75], [3, 1], [10, 1]] as const) {
      const s = nearBingo({ mainIdx: 29, bet, jackpot: 5400, credits: 500, turbo: true });
      const c = await open(browser, s);
      const p = c.page;
      await enter(p);
      const tbl = await p.locator('.ptab .pr').allTextContents();
      await p.waitForSelector('text=CONTINUAR', { timeout: 20000 });
      await p.waitForTimeout(1800); // contagem animada (1,2 s)
      const celeb = (await p.locator('.celeb').innerText()).replace(/\n/g, ' / ');
      const prize = Math.floor(5400 * pct) + 500 * bet;
      const shown = celeb.match(/\+([\d.]+)/)?.[1]?.replace(/\./g, '');
      chk(`aposta ${bet}: tela de celebração mostra +${prize} (acumulado ${pct * 100}% + bingo)`, shown === String(prize), `celebração="${celeb}"`);
      await p.getByRole('button', { name: /CONTINUAR/ }).click();
      await p.waitForTimeout(2200);
      const crEnd = Number(await credits(p));
      const jk = await p.locator('.stat.jack .val').textContent();
      chk(`aposta ${bet}: créditos 500 -> ${500 + prize}; acumulado volta a 5.000`, crEnd === 500 + prize && /5\.0\d\d/.test(jk!), `credits=${crEnd} acumulado=${jk}`);
      note(`aposta ${bet}: linha do acumulado na tabela antes da rodada: ${tbl.filter((t) => /Acum/.test(t)).join('|')}`);
      await c.ctx.close();
    }
    // bingo na EXTRA: sem acumulado
    {
      const s = nearBingo({ mainIdx: 30, credits: 800, extrasDecisive: true, free: [false], turbo: true });
      const c = await open(browser, s);
      const p = c.page;
      await enter(p);
      await p.waitForSelector('.xpanel:not(.hide)', { timeout: 20000 });
      const titleOffer = await p.locator('.xtitle').textContent();
      await p.locator('.xbuy').click();
      await p.waitForSelector('text=CONTINUAR', { timeout: 20000 });
      await p.waitForTimeout(1800);
      const celeb = (await p.locator('.celeb').innerText()).replace(/\n/g, ' / ');
      chk('bingo na bola extra: celebração +2.500 e SEM texto de acumulado', /\+2\.500/.test(celeb) && !/ACUMULADO/i.test(celeb), `"${celeb}" (oferta "${titleOffer}")`);
      await c.ctx.close();
    }
  }

  // ------------------------------------------------------------------ 6) controles: aposta 1..10, cartelas 1..4, tocar na cartela não faz nada, tabela com valores
  if (on('controls')) {
    const c = await open(browser, baseSave(1));
    const p = c.page;
    await enter(p);
    const betVal = () => p.locator('.g-bet .l2').textContent();
    const cardsVal = () => p.locator('.g-cards .l2').textContent();
    const rows = async () => (await p.locator('.ptab .pr').evaluateAll((els) => els.map((e) => `${e.querySelector('.nm .full')?.textContent}=${e.querySelector('.pv')?.textContent}`)));
    const clk = async (sel: string, n: number) => { for (let i = 0; i < n; i++) { await p.locator(sel).click({ force: true }); await p.waitForTimeout(140); } };
    const seq: string[] = [];
    await clk('.g-bet .sq >> nth=0', 12); // −
    chk('aposta mínima 1; botão − desabilitado', (await betVal()) === '1' && (await p.locator('.g-bet .sq').nth(0).isDisabled()));
    const t1 = await rows();
    chk('bet=1: tabela Linha=5 / Linha dupla=25 / BINGO=500 / "Acumulado: 50%" = 2.500', t1.join('|') === 'Linha=5|Linha dupla=25|BINGO=500|Acumulado: 50%=2.500', JSON.stringify(t1));
    seq.push(JSON.stringify(t1));
    await clk('.g-bet .sq >> nth=1', 1); await p.waitForTimeout(200);
    const t2 = await rows();
    note(`bet=2: ${JSON.stringify(t2)}`);
    chk('bet=2: Linha=10, Linha dupla=50, BINGO=1.000, Acumulado: 75% = 3.750', t2.join('|') === 'Linha=10|Linha dupla=50|BINGO=1.000|Acumulado: 75%=3.750', t2.join('|'));
    await clk('.g-bet .sq >> nth=1', 1); await p.waitForTimeout(200);
    const t3 = await rows();
    chk('bet=3: Acumulado cheio (5.000) sem %', t3.join('|') === 'Linha=15|Linha dupla=75|BINGO=1.500|Acumulado=5.000', JSON.stringify(t3));
    await clk('.g-bet .sq >> nth=1', 12);
    await p.waitForTimeout(300);
    const t10 = await rows();
    chk('aposta máxima 10: Linha 50, Linha dupla 250, BINGO 5.000; + desabilitado', (await betVal()) === '10' && t10.slice(0, 3).join('|') === 'Linha=50|Linha dupla=250|BINGO=5.000' && (await p.locator('.g-bet .sq').nth(1).isDisabled()), JSON.stringify(t10));
    const tot = await p.locator('button.play .ps').textContent();
    chk('JOGAR mostra "Total 40" (10 × 4)', /40/.test(tot!), tot ?? '');
    // todas as apostas 1..10 percorridas
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) { seen.push((await betVal())!); if (i < 9) await clk('.g-bet .sq >> nth=0', 1); }
    chk('percorre 10,9,...,1 pelos botões', seen.join() === '10,9,8,7,6,5,4,3,2,1', seen.join());
    // cartelas
    await clk('.g-cards .sq >> nth=0', 6);
    chk('Cartelas mínimo 1: só a cartela 1 ativa, 3 "Desligada"', (await cardsVal()) === '1' && (await p.locator('.card.off').count()) === 3);
    for (const [i, n] of [[2, 2], [3, 3], [4, 4]] as const) { await clk('.g-cards .sq >> nth=1', 1); chk(`Cartelas ${n}: ${n} ativas`, (await cardsVal()) === String(n) && (await p.locator('.card:not(.off)').count()) === n); void i; }
    chk('Cartelas máx 4: + desabilitado', await p.locator('.g-cards .sq').nth(1).isDisabled());
    // tocar na cartela não faz nada
    await p.waitForTimeout(500); // deixa o debounce de 200 ms do save gravar
    const before = JSON.stringify({ a: (await saved(p)).active, off: await p.locator('.card.off').count(), total: await p.locator('button.play .ps').textContent() });
    for (let i = 0; i < 4; i++) { await p.locator('.cards .card').nth(i).click({ force: true }); await p.locator('.cards .card').nth(i).locator('.cell').nth(7).click({ force: true }); }
    await p.waitForTimeout(500);
    const after = JSON.stringify({ a: (await saved(p)).active, off: await p.locator('.card.off').count(), total: await p.locator('button.play .ps').textContent() });
    chk('M11: tocar nas cartelas/células (idle) não desliga nada', before === after, before + ' vs ' + after);
    // durante a rodada também
    await p.locator('button.play').click();
    await p.waitForTimeout(1200);
    for (let i = 0; i < 4; i++) await p.locator('.cards .card').nth(i).click({ force: true });
    await p.waitForTimeout(300);
    chk('tocar nas cartelas durante o sorteio não faz nada', (await p.locator('.card.off').count()) === 0);
    chk('Números (botão) desabilitado durante a rodada', await p.locator('.g-nums').isDisabled());
    await finishRound(p, 120_000);
    // Números: cartelas novas, só entre rodadas
    const nums0 = await p.locator('.card').first().locator('.cell').allTextContents();
    await p.locator('.g-nums').click();
    await p.waitForTimeout(800);
    const nums1 = await p.locator('.card').first().locator('.cell').allTextContents();
    chk('Números troca as cartelas', nums0.join() !== nums1.join());
    const all = await p.locator('.card').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.cell')].map((c) => Number(c.textContent))));
    const okRange = all.every((nums) => nums.length === 15 && nums.every((n, i) => n >= 18 * (i % 5) + 1 && n <= 18 * (i % 5) + 18) && new Set(nums).size === 15);
    chk('cartelas na tela: 3x5, números na faixa de 18 por coluna', okRange, JSON.stringify(all[0]));
    chk('sem erros JS', c.errs.length === 0, JSON.stringify(c.errs));
    await c.ctx.close();
  }

  // ------------------------------------------------------------------ 7) contador e trilho durante a rodada
  if (on('trail')) {
    const c = await open(browser, withRound(baseSave(2), mkPlan(baseSave(2).cards, {}), { mainIdx: 0, credits: 980, turbo: false }));
    const p = c.page;
    await p.evaluate(() => localStorage.getItem('x'));
    await enter(p);
    await p.waitForTimeout(100);
    const seq: string[] = [];
    for (let i = 0; i < 5; i++) { seq.push((await p.locator('.ballsec .counter').textContent())!); await p.waitForTimeout(1900); }
    chk('contador "Bola X de 30" avança', /^Bola \d+ de 30$/.test(seq[0]) && seq[4] !== seq[0], seq.join(' | '));
    const filled = await p.locator('.trail .tr-main .tc.on').count();
    chk('trilho: casas preenchidas = bolas sorteadas, em 3 fileiras de 10', filled >= 5 && (await p.evaluate(() => { const r = [...document.querySelectorAll('.trail .tr-main .tc')].map((e) => (e as HTMLElement).offsetTop); return new Set(r).size; })) === 3);
    const ex = await p.locator('.trail .tr-extra .tc').count();
    chk('trilho: 9 casas de extra com contorno tracejado', ex === 9 && (await p.evaluate(() => getComputedStyle(document.querySelector('.trail .tr-extra .tc')!).borderTopStyle)) === 'dashed');
    const order = await p.evaluate(() => [...document.querySelectorAll('.trail .tr-main .tc.on')].map((e) => Number(e.textContent)));
    const plan = (await saved(p)).round.plan.main.slice(0, order.length);
    chk('trilho na ORDEM do sorteio', JSON.stringify(order) === JSON.stringify(plan), `${order.join(',')}`);
    const colors = await p.evaluate(() => [...document.querySelectorAll('.trail .tr-main .tc.on')].map((e) => ({ n: Number(e.textContent), c: [...e.classList].find((k) => /^r\d$/.test(k)) })));
    chk('cor da bola por faixa de 18 (r1..r5)', colors.every((x) => x.c === `r${Math.min(5, Math.floor((x.n - 1) / 18) + 1)}`), JSON.stringify(colors.slice(0, 6)));
    await c.ctx.close();
  }

  // ------------------------------------------------------------------ 8) correio da sorte no app real
  if (on('mail')) {
    // diário: save com lastDailyBonus antigo
    const s = baseSave(1);
    s.lastDailyBonus = '2000-01-01';
    s.mail = { day: '', bonusToday: 0, playMs: 0, pending: null };
    const c = await open(browser, s);
    const p = c.page;
    await enter(p);
    await p.waitForTimeout(400);
    const icon = p.locator('.mailb');
    chk('1ª abertura do dia: ícone do correio visível (alvo >= 64 px)', await icon.isVisible() && (await icon.boundingBox())!.height >= 63.5, JSON.stringify(await icon.boundingBox()));
    chk('ícone balança (animação ativa) e tem selo 🍀', (await p.evaluate(() => document.getAnimations().length)) > 0 && /🍀/.test((await icon.textContent()) ?? ''));
    chk('créditos ainda 1.000 (não entrou sozinho: M6)', (await credits(p)) === '1000');
    await icon.click();
    await p.waitForSelector('.mailay:not(.hide)', { timeout: 3000 });
    const txt = (await p.locator('.mailay .dlg').innerText()).replace(/\n/g, ' / ');
    chk('tela grande: "Correio da sorte da Dona Altina!", +300 créditos, botão PEGAR', /Correio da sorte da Dona Altina/.test(txt) && /\+300 créditos/.test(txt) && /PEGAR/.test(txt), txt);
    await p.locator('.mailay .btn.big').click();
    await p.waitForTimeout(1500);
    chk('PEGAR: +300 (1.300), tela fecha, ícone some', (await credits(p)) === '1300' && !(await p.locator('.mailay:not(.hide)').count()) && !(await icon.isVisible()));
    chk('lastDailyBonus = hoje', (await saved(p)).lastDailyBonus === today());
    await p.reload(); await enter(p);
    chk('reabrir no mesmo dia: sem correio', !(await icon.isVisible()));
    await c.ctx.close();

    // nunca sobre a oferta de extra nem durante o sorteio: salva com carta pendente + rodada na oferta
    const s2 = nearDouble({ free: [false], credits: 800 });
    s2.mail = { day: today(), bonusToday: 0, playMs: 0, pending: { kind: 'daily', amount: 300 } };
    s2.lastDailyBonus = '2000-01-01';
    const c2 = await open(browser, s2);
    const p2 = c2.page;
    await enter(p2);
    await p2.waitForSelector('.xpanel:not(.hide)', { timeout: 20000 });
    const st = await p2.evaluate(() => ({ icon: !!document.querySelector('.mailb:not(.hide)') && (document.querySelector('.mailb') as HTMLElement).getBoundingClientRect().width > 0, layer: !!document.querySelector('.mailay:not(.hide)') }));
    chk('oferta de extra com carta pendente: nem ícone nem tela do correio aparecem', !st.icon && !st.layer, JSON.stringify(st));
    await p2.locator('.xend').click();
    await p2.waitForTimeout(3500);
    const st2 = await p2.evaluate(() => ({ icon: (document.querySelector('.mailb') as HTMLElement | null)?.getBoundingClientRect().width ?? 0 }));
    chk('depois da rodada a carta aparece (ocioso)', st2.icon > 0, JSON.stringify(st2));
    await c2.ctx.close();

    // durante o sorteio
    const s3 = baseSave(1);
    s3.mail = { day: today(), bonusToday: 0, playMs: 0, pending: { kind: 'bonus', amount: 40 } };
    s3.settings.speed = 'lenta';
    const c3 = await open(browser, s3);
    const p3 = c3.page;
    await enter(p3);
    chk('ocioso com carta de bônus: ícone visível', await p3.locator('.mailb').isVisible());
    await p3.locator('button.play').click();
    await p3.waitForTimeout(1200);
    chk('durante o sorteio: ícone oculto', !(await p3.locator('.mailb').isVisible()));
    await c3.ctx.close();
  }

  // ------------------------------------------------------------------ 9) retomada, janela de liquidação (reload durante "Conferindo")
  if (on('reload')) {
    // plano: linha completa na 30ª bola (prêmio 25) e nada mais; turbo
    const s = baseSave(2);
    const c0 = s.cards[0].nums;
    const plan = mkPlan(s.cards, { early: c0.slice(0, 4), late: [c0[4]] });
    withRound(s, plan, { mainIdx: 29, credits: 980, turbo: true });
    const c = await open(browser, s);
    const p = c.page;
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(450); // dentro da janela de espera pós-liquidação (900-1800 ms)
    const mid = await p.evaluate(() => ({ cr: document.querySelector('.cred .val')?.textContent, play: (document.querySelector('button.play') as HTMLButtonElement).disabled }));
    await p.reload();
    await p.getByText('ENTRAR').click();
    await p.waitForTimeout(3500);
    const sv = await saved(p);
    const crShown = await credits(p);
    note(`antes do reload (450 ms após ENTRAR): créditos na tela=${mid.cr}, JOGAR desabilitado=${mid.play}; depois: tela=${crShown} save=${sv.credits} rodadas=${sv.stats.rodadas}`);
    chk('reload durante a liquidação NÃO paga o prêmio 2x (esperado 980 + 25 = 1005)', sv.credits === 1005 && sv.stats.rodadas === 1, `credits=${sv.credits} rodadas=${sv.stats.rodadas}`);
    await c.ctx.close();

    // retomada simples no meio (app real)
    const s2 = blankRound({ turbo: true, mainIdx: 12, credits: 777 });
    const c2 = await open(browser, s2);
    await c2.page.getByText('ENTRAR').click();
    await c2.page.waitForTimeout(150);
    const hist = await c2.page.evaluate(() => [...document.querySelectorAll('.trail .tr-main .tc.on')].map((e) => Number(e.textContent)));
    chk('retomada no meio: histórico das 12+ bolas reconstruído no trilho, crédito 777 intacto', hist.slice(0, 12).join() === s2.round!.plan.main.slice(0, 12).join() && (await credits(c2.page)) === '777', `trilho=${hist.length} bolas`);
    const r = await finishRound(c2.page, 40_000);
    chk('retomada termina e libera JOGAR', r.ok);
    await c2.ctx.close();
  }

  // ------------------------------------------------------------------ 10) AudioContext suspenso no meio (M12)
  if (on('m12')) {
    const c = await open(browser, baseSave(4));
    const p = c.page;
    await enter(p);
    await p.locator('button.play').click();
    await p.waitForFunction(() => document.querySelectorAll('.trail .tr-main .tc.on').length >= 2, null, { timeout: 20000 });
    const n0 = await p.locator('.trail .tr-main .tc.on').count();
    const states: string[] = [];
    for (let i = 0; i < 8; i++) {
      await p.evaluate(() => (window as any).__ctx?.suspend());
      states.push(await p.evaluate(() => (window as any).__ctx?.state));
      await p.waitForTimeout(1500);
    }
    const n1 = await p.locator('.trail .tr-main .tc.on').count();
    chk('M12: com o AudioContext suspenso repetidamente a rodada CONTINUA (não trava)', n1 > n0 + 3, `bolas ${n0} -> ${n1} em 12 s; estados=${states.join(',')}`);
    await c.ctx.close();
  }

  // ------------------------------------------------------------------ 11) M7: modo leve
  if (on('m7')) {
    // a) primeira abertura com prefers-reduced-motion sugere "leve" mas sem lightManual; b) escolha manual nunca é sobrescrita
    const c = await open(browser, null, { width: 1280, height: 800 }, { reducedMotion: true });
    const p = c.page;
    await enter(p);
    await p.waitForTimeout(300);
    let sv = await saved(p);
    chk('M7: reduced-motion na 1ª abertura sugere modo leve (light=true) como PADRÃO, sem marcar escolha manual', sv.settings.light === true && sv.settings.lightManual === false, JSON.stringify({ l: sv.settings.light, m: sv.settings.lightManual }));
    // usuário desliga manualmente
    await p.locator('.top .gear').click();
    await p.locator('.tabs .tab').nth(2).click();
    const lightBtn = p.locator('.pane:not(.hide) .trow').filter({ hasText: 'Modo leve' }).locator('button');
    await lightBtn.click();
    await p.waitForTimeout(400);
    sv = await saved(p);
    chk('escolha manual (desligar) grava lightManual=true, light=false', sv.settings.light === false && sv.settings.lightManual === true, JSON.stringify({ l: sv.settings.light, m: sv.settings.lightManual }));
    await p.reload();
    await enter(p);
    await p.waitForTimeout(300);
    sv = await saved(p);
    chk('reload com reduced-motion: NÃO volta a ligar o leve (respeita a escolha)', sv.settings.light === false, JSON.stringify(sv.settings));
    // c) FPS baixo (CPU 20x) só depois de 3 rodadas e nunca sobre escolha manual
    const cdp = await c.ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 25 });
    await p.locator('.g-turbo').click().catch(() => {});
    for (let i = 0; i < 4; i++) {
      await p.locator('button.play').click();
      await finishRound(p, 80_000);
      await p.waitForTimeout(300);
    }
    await p.waitForTimeout(4500);
    sv = await saved(p);
    chk('M7: com CPU 25x mais lenta, 4 rodadas, ESCOLHA MANUAL (leve desligado) NÃO é sobrescrita', sv.settings.light === false, JSON.stringify({ l: sv.settings.light, m: sv.settings.lightManual }));
    await c.ctx.close();

    // d) sem escolha manual: nada de leve no carregamento nem nas rodadas 1-3; liga só no 4º sorteio com FPS baixo
    const s = baseSave(5);
    s.settings.turbo = true;
    const c2 = await open(browser, s);
    const p2 = c2.page;
    const cdp2 = await c2.ctx.newCDPSession(p2);
    await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 25 });
    await p2.reload();
    await enter(p2);
    await p2.waitForTimeout(4000);
    chk('M7: carregamento/ocioso com CPU lenta NÃO liga o leve', (await saved(p2)).settings.light === false);
    const lights: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      await p2.locator('button.play').click();
      await finishRound(p2, 80_000);
      await p2.waitForTimeout(1500);
      lights.push((await saved(p2)).settings.light);
    }
    await p2.waitForTimeout(4500);
    lights.push((await saved(p2)).settings.light);
    chk('M7: leve automático só a partir do 4º sorteio (rodadas 1-3 = false)', lights.slice(0, 3).every((x) => x === false), `light após rodadas 1..4 e +4 s: ${lights.join(',')}`);
    note(`modo leve automático depois da 4ª rodada (CPU 25x): ${lights[4]} (esperado true em dispositivo lento)`);
    await c2.ctx.close();
  }


  // ------------------------------------------------------------------ 13) "falta 1": fala x aviso visual (M9) e Turbo
  if (on('almost')) {
    for (const turbo of [false, true]) {
      const s = baseSave(3);
      const c0 = s.cards[0].nums;
      s.settings.speed = 'rapida';
      const plan = mkPlan(s.cards, { early: c0.slice(0, 14) });
      withRound(s, plan, { mainIdx: 12, credits: 980, turbo });
      const c = await open(browser, s);
      await enter(c.page);
      await c.page.waitForTimeout(7000);
      const l = await log(c.page);
      const caps = l.caps.filter((x) => x.on).map((x) => `${x.spk ? 'FALA' : x.hot ? 'AVISO' : 'estado'}:${x.text}`);
      note(`${turbo ? 'TURBO' : 'normal'}: legendas ${JSON.stringify(caps.filter((x) => !x.startsWith('estado')))}`);
      const spokenAlmost = l.caps.some((x) => x.spk && /Falta uma|quase/i.test(x.text));
      const hotAlmost = l.caps.some((x) => x.hot && /FALTA 1/.test(x.text));
      if (!turbo) chk('normal: "falta 1" falado ("Falta uma pro bingo!"/"Tá quase o bingo!") na legenda', spokenAlmost, JSON.stringify(caps.filter((x) => !x.startsWith('estado')).slice(0, 8)));
      else chk('Turbo: "falta 1" NÃO é falado', !spokenAlmost);
      note(`${turbo ? 'TURBO' : 'normal'}: aviso visual "FALTA 1!" (não falado) apareceu = ${hotAlmost}${turbo && hotAlmost ? ' -> legenda sem fala correspondente (design: aviso visual); registrar como MENOR se o critério for estrito legenda = fala' : ''}`);
      await c.ctx.close();
    }
  }

  // ------------------------------------------------------------------ 14) vazamentos: várias rodadas em Turbo
  if (on('leaks')) {
    const s = baseSave(6);
    s.settings.turbo = true;
    const c = await open(browser, s);
    const p = c.page;
    await enter(p);
    const lives: number[] = [];
    const nodes: number[] = [];
    for (let i = 0; i < 6; i++) {
      await p.locator('button.play').click();
      await finishRound(p, 60_000);
      await p.waitForTimeout(2600);
      const m = await p.evaluate(() => ({ live: (window as any).__log.live.size, nodes: document.getElementsByTagName('*').length, anims: document.getAnimations().length, ints: (window as any).__log.intervals }));
      lives.push(m.live); nodes.push(m.nodes);
      if (i === 5) chk('após 6 rodadas: animações ativas = 0, setInterval = 0', m.anims === 0 && m.ints === 0, JSON.stringify(m));
    }
    chk('timeouts vivos em repouso não crescem a cada rodada', lives[5] <= lives[0] + 1, `live por rodada=${lives.join(',')}`);
    chk('nós do DOM estáveis (sem acumular confete/elementos)', nodes[5] <= nodes[0] + 10, `nós por rodada=${nodes.join(',')}`);
    await c.ctx.close();
  }

  // ------------------------------------------------------------------ 15) acumulado parcial: valor mostrado x valor pago
  if (on('jpdisplay')) {
    for (const [bet, jk, pct] of [[2, 5001, 0.75], [1, 5003, 0.5]] as const) {
      const s = baseSave(1); s.bet = bet; s.jackpot = jk;
      const c = await open(browser, s);
      await enter(c.page);
      const shown = (await c.page.locator('.ptab .pr').nth(3).locator('.pv').textContent())!.replace(/\./g, '');
      chk(`valor mostrado do Acumulado (aposta ${bet}, ${pct * 100}% de ${jk}) = valor pago ${Math.floor(jk * pct)}`, Number(shown) === Math.floor(jk * pct), `mostra ${shown}, paga ${Math.floor(jk * pct)} (fmt arredonda, o pagamento usa floor)`);
      await c.ctx.close();
    }
  }

  // ------------------------------------------------------------------ 12) presente, auto
  if (on('gift')) {
    const s = baseSave(10); s.credits = 30;
    const c = await open(browser, s);
    const p = c.page;
    await enter(p);
    await p.locator('button.play').click();
    await p.waitForSelector('text=PEGAR');
    const g = (await p.locator('.layer:not(.hide) .dlg').innerText()).replace(/\n/g, ' / ');
    chk('presente: tela com +1000 e PEGAR (saldo 30 não é debitado)', /1000/.test(g) && (await credits(p)) === '30', g);
    await p.getByRole('button', { name: /PEGAR/ }).click();
    await p.waitForTimeout(2000);
    chk('PEGAR: 1.030 créditos', (await credits(p)) === '1030');
    await c.ctx.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo OK');
  console.log('requisições ruins (todas as páginas):', JSON.stringify([...new Set(allBad)]), 'erros JS:', JSON.stringify(allErrs));
  writeFileSync('/tmp/claude-0/flows-out.txt', out.join('\n'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
void BASE; void KEY; void VIEWPORTS; void LINE_BY_ID; void audit;
