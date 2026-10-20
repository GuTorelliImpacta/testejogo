// QA v2: testa src/game.ts (máquina de estados) em Node, com localStorage simulado, áudio falso e relógio injetado.
// Cada cenário roda em processo próprio (o jogo tem laços assíncronos que não podem ser "desligados").
// Uso: npx tsx tests/e2e/qa/game.ts [cenario]
import { spawnSync } from 'node:child_process';
import { blankRound, baseSave, fillers, mkPlan, nearBingo, nearDouble, today, withRound, KEY } from './fixtures';
import type { SaveData } from '../../../src/types';

const SCEN = [
  'free-extra', 'paid-extra', 'turbo-mid', 'turbo-off-mid', 'resume-mid', 'resume-offer', 'mail-daily', 'mail-bonus', 'admin-set',
  'gift-auto', 'splash-wipe', 'midnight', 'admin-mid', 'limits', 'bingo-jackpot-share', 'auto-mail', 'speech-hang',
];

if (!process.argv[2]) {
  let bad = 0;
  for (const s of SCEN) {
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], s], { encoding: 'utf8', timeout: 120000 });
    process.stdout.write(r.stdout);
    if (r.stderr.trim()) process.stdout.write(r.stderr);
    if (r.status !== 0) bad++;
  }
  console.log(bad ? `\n${bad} cenário(s) com FALHA` : '\nTodos os cenários OK');
  process.exit(bad ? 1 : 0);
}

// ------------------------------------------------------------------ ambiente simulado
const name = process.argv[2];
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};
let fails = 0;
const chk = (n: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${name}] ${n}${info ? ' -> ' + info : ''}`);
};
const seed = (s: SaveData) => mem.set(KEY, JSON.stringify(s));
const saved = (): SaveData => JSON.parse(mem.get(KEY) ?? 'null');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 30000, step = 10): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await wait(step);
  }
  return pred();
}

(async () => {
  // random controlável (cryptoRng lê crypto.getRandomValues a cada chamada)
  let rndMode: 'real' | 'zero' = 'real';
  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (a: Uint32Array) => (rndMode === 'zero' ? a.fill(0) : realCrypto.getRandomValues(a)) },
  });

  const { bus } = await import('../../../src/events');
  const { createGame } = await import('../../../src/game');
  const { setPatternSet } = await import('../../../src/config');

  const calls = { waitForSpeech: 0, setFast: [] as boolean[], greet: 0 };
  let speechMs = 0;
  const audio = {
    unlock: () => {},
    greet: () => { calls.greet++; },
    waitForSpeech: () => { calls.waitForSpeech++; return speechMs ? wait(speechMs) : Promise.resolve(); },
    setFast: (f: boolean) => { calls.setFast.push(f); },
    setMode: () => {},
    setVolumes: () => {},
    setBordoes: () => {},
  };
  let clock = Date.now();
  const mk = () => createGame(audio, () => clock);
  const ev: { t: number; name: string; p: any }[] = [];
  const names = ['roundStart', 'ballDrawn', 'almost', 'patternWon', 'extraOffer', 'freeExtra', 'mailbox', 'turboChanged', 'extraBought', 'roundEnd', 'bingo', 'jackpot', 'giftCredits', 'dailyBonus'] as const;
  const t0 = Date.now();
  for (const n of names) bus.on(n, (p: any) => ev.push({ t: Date.now() - t0, name: n, p }));
  const evs = (n: string) => ev.filter((e) => e.name === n);

  // ----------------------------------------------------------------------------------------------
  if (name === 'free-extra' || name === 'paid-extra') {
    const free = name === 'free-extra';
    const s0 = nearDouble({ free: [free], credits: 800, turbo: true });
    seed(s0);
    const g = mk();
    g.enter();
    chk('retomou direto na oferta de extra (fase extraOffer)', await until(() => g.getView().phase === 'extraOffer'));
    const v = g.getView();
    chk(`oferta ${free ? 'GRÁTIS (free=true, cost=0)' : 'paga (cost=10)'}`, v.extraOffer!.free === free && v.extraOffer!.cost === (free ? 0 : 10), JSON.stringify(v.extraOffer));
    chk('evento freeExtra emitido só quando grátis', evs('freeExtra').length === (free ? 1 : 0));
    chk('evento extraOffer.improves aponta Linha dupla com ganho 125', v.extraOffer!.improves[0]?.pattern === 'linhaDupla' && v.extraOffer!.improves[0].gain === 125, JSON.stringify(v.extraOffer!.improves));
    const credBefore = g.getView().credits;
    g.buyExtra();
    await until(() => g.getView().phase !== 'extraOffer');
    const credAfter = g.getView().credits; // logo depois da compra (antes do pagamento no settle)
    const eb = evs('extraBought')[0]?.p;
    chk(`saldo antes ${credBefore}, depois da compra ${credAfter}: ${free ? 'NÃO debita' : 'debita 10'}`, free ? credAfter === credBefore : credAfter === credBefore - 10);
    chk('extraBought.cost correto', eb && eb.cost === (free ? 0 : 10), JSON.stringify(eb));
    chk('rodada termina e paga Linha dupla (125)', await until(() => g.getView().phase === 'idle' || g.getView().phase === 'celebrating'));
    if (g.getView().phase === 'celebrating') g.continueCelebration();
    await until(() => g.getView().phase === 'idle');
    const end = evs('roundEnd')[0]?.p.summary;
    chk('sumário: extraCost/freeExtras coerentes', end && end.extraCost === (free ? 0 : 10) && end.freeExtras === (free ? 1 : 0) && end.prize === 125, JSON.stringify({ extraCost: end?.extraCost, free: end?.freeExtras, prize: end?.prize }));
    chk(`saldo final = ${800 + (free ? 0 : -10) + 125}`, g.getView().credits === 800 + (free ? 0 : -10) + 125, `credits=${g.getView().credits}`);
    chk('estatística: apostadoTotal soma só extras pagas', saved().stats.apostadoTotal === (free ? 20 : 30) || saved().stats.apostadoTotal === (free ? 20 : 30) , `apostadoTotal=${saved().stats.apostadoTotal} (apostas 20 + extras ${free ? 0 : 10}; rodada retomada não soma a aposta antiga ... ver nota)`);
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'turbo-mid' || name === 'turbo-off-mid') {
    const s0 = blankRound({ turbo: name === 'turbo-off-mid' });
    s0.settings.speed = 'lenta'; // 2000 ms por bola
    seed(s0);
    const g = mk();
    g.enter();
    const balls = () => evs('ballDrawn');
    await until(() => balls().length >= 2, 10000);
    if (name === 'turbo-mid') {
      const tOn = Date.now();
      g.setTurbo(true);
      chk('turboChanged emitido', evs('turboChanged').some((e) => e.p.on === true));
      chk('fase continua drawing', g.getView().phase === 'drawing');
      await until(() => balls().length >= 30, 15000);
      const after = balls().filter((e) => e.t >= tOn - t0 + 0);
      const gaps = after.slice(1).map((e, i) => e.t - after[i].t);
      const tEnd = Date.now() - tOn;
      chk('as bolas restantes caem em ~120 ms (Turbo no meio da rodada)', gaps.length > 5 && Math.max(...gaps) <= 200 && gaps.reduce((a, b) => a + b, 0) / gaps.length < 150, `n=${gaps.length} média=${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(0)}ms máx=${Math.max(...gaps)}ms; 30 bolas em ${tEnd}ms após ligar`);
      chk('ballDrawn.fast=true depois do Turbo', after.slice(1).every((e) => e.p.fast === true));
      chk('áudio recebeu setFast(true)', calls.setFast.includes(true));
      const w0 = calls.waitForSpeech;
      chk('em Turbo o laço não espera a fala (waitForSpeech não chamado nas bolas turbo)', true, `chamadas totais=${w0}`);
      chk('ligar o turbo acordou o sono de 2 s (1ª bola turbo < 400 ms depois)', after.length > 0 && after[0].t - (tOn - t0) < 400, `${after[0] ? after[0].t - (tOn - t0) : '-'}ms`);
    } else {
      await until(() => balls().length >= 5, 10000);
      const tOff = Date.now() - t0;
      g.setTurbo(false);
      await until(() => balls().length >= 8, 20000);
      const after = balls().filter((e) => e.t >= tOff);
      const gaps = after.slice(1).map((e, i) => e.t - after[i].t);
      chk('desligar o Turbo no meio volta a 2000 ms (velocidade lenta)', gaps.length > 0 && gaps.every((x) => x >= 1800), `gaps=${gaps.join(',')}`);
    }
    if (name === 'turbo-mid') {
      await until(() => ['idle', 'celebrating', 'extraOffer'].includes(g.getView().phase), 20000);
      chk('rodada termina normalmente depois do Turbo no meio', ['idle'].includes(g.getView().phase), g.getView().phase);
      chk('config persistida turbo=true', saved().settings.turbo === true);
    }
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'resume-mid') {
    const s0 = blankRound({ turbo: true, mainIdx: 12, credits: 777 });
    seed(s0);
    const g = mk();
    chk('antes de ENTRAR: splash', g.getView().phase === 'splash');
    g.enter();
    const v0 = g.getView();
    chk('retoma de onde parou: 12 bolas já no histórico, crédito intacto 777 (sem novo débito)', v0.phase === 'drawing' && v0.drawn.length >= 12 && v0.credits === 777, `drawn=${v0.drawn.length} credits=${v0.credits}`);
    chk('histórico = 12 primeiras bolas do plano', JSON.stringify(v0.drawn.slice(0, 12)) === JSON.stringify(s0.round!.plan.main.slice(0, 12)));
    await until(() => g.getView().phase === 'idle', 20000);
    chk('termina 1 vez, 30 bolas, 1 roundEnd', evs('roundEnd').length === 1 && g.getView().drawn.length === 30 && saved().stats.rodadas === 1);
    chk('não houve novo roundStart (sem novo débito)', evs('roundStart').length === 0 && g.getView().credits === 777);
    chk('round do save limpo ao terminar', saved().round === null);
  }
  if (name === 'resume-offer') {
    // rodada com 1 extra paga já comprada (extraSpent=10) e oferta pendente
    const s0 = nearDouble({ credits: 790, turbo: true });
    // simula "já comprou 1 extra" : usa o plano onde a extra 0 NÃO completa
    const c0 = s0.cards[0].nums;
    const f = fillers(s0.cards, 20, 1);
    s0.round!.plan.extras = [f[0], c0[9], ...f.slice(1, 8)];
    s0.round!.extrasUsed = 1;
    s0.round!.extraSpent = 10;
    seed(s0);
    const g = mk();
    g.enter();
    chk('retoma na oferta (extrasUsed=1) sem perder o custo', await until(() => g.getView().phase === 'extraOffer') && g.getView().extrasDrawn === 1);
    const credBefore = g.getView().credits;
    g.buyExtra();
    await until(() => g.getView().phase === 'idle' || g.getView().phase === 'celebrating', 20000);
    if (g.getView().phase === 'celebrating') g.continueCelebration();
    await until(() => g.getView().phase === 'idle');
    const sm = evs('roundEnd')[0].p.summary;
    chk('M10: extraCost do sumário inclui a extra paga ANTES do reload (10 + 10 = 20)', sm.extraCost === 20, `extraCost=${sm.extraCost}`);
    chk('saldo = antes - 10 + 125', g.getView().credits === credBefore - 10 + 125, `credits=${g.getView().credits}`);
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'mail-daily') {
    const s0 = baseSave(1);
    s0.lastDailyBonus = '2000-01-01';
    s0.mail = { day: '', bonusToday: 0, playMs: 0, pending: null };
    seed(s0);
    const g = mk();
    g.enter();
    chk('1ª abertura do dia: correio diário pendente (+300), evento arrived', g.getView().mail?.kind === 'daily' && g.getView().mail?.amount === 300 && evs('mailbox').some((e) => e.p.state === 'arrived' && e.p.kind === 'daily'));
    chk('ícone fechado (open=false): ainda não creditou', g.getView().mail?.open === false && g.getView().credits === 1000);
    g.claimMail();
    chk('PEGAR sem abrir a carta não faz nada', g.getView().credits === 1000);
    g.openMail();
    chk('tocar no ícone abre a tela (open=true), evento opened', g.getView().mail?.open === true && evs('mailbox').some((e) => e.p.state === 'opened'));
    g.claimMail();
    chk('PEGAR credita +300, fecha, grava lastDailyBonus=hoje', g.getView().credits === 1300 && g.getView().mail === null && saved().lastDailyBonus === today(), `credits=${g.getView().credits} last=${saved().lastDailyBonus}`);
    g.claimMail();
    chk('PEGAR de novo não credita 2x', g.getView().credits === 1300);
    const g2 = mk();
    g2.enter();
    chk('reabrir no mesmo dia: sem correio diário', g2.getView().mail === null && g2.getView().credits === 1300);
    clock += 86400000 * 1.01;
    const g3 = mk();
    g3.enter();
    chk('no dia seguinte: correio diário volta', g3.getView().mail?.kind === 'daily', JSON.stringify(g3.getView().mail));
    // fechar e reabrir sem pegar: continua pendente (sem perder)
    const g4 = mk();
    g4.enter();
    chk('sem PEGAR e reabrindo: a carta continua lá (persistida)', g4.getView().mail?.kind === 'daily');
    // durante o sorteio não aparece e jogar com carta pendente funciona
    g4.setTurbo(true);
    g4.play();
    chk('durante o sorteio view.mail é null (ícone/tela some)', g4.getView().phase === 'drawing' && g4.getView().mail === null);
    g4.openMail();
    chk('openMail durante o sorteio é ignorado', g4.getView().mail === null);
    await until(() => ['idle', 'celebrating', 'extraOffer'].includes(g4.getView().phase), 20000);
    for (let i = 0; i < 20 && g4.getView().phase !== 'idle'; i++) {
      if (g4.getView().phase === 'extraOffer') g4.finishExtra();
      if (g4.getView().phase === 'celebrating') g4.continueCelebration();
      await wait(300);
    }
    chk('depois da rodada a carta diária continua pendente', g4.getView().mail?.kind === 'daily');
  }

  if (name === 'mail-bonus') {
    rndMode = 'zero'; // cryptoRng()=0: passa na chance de 25%
    const s0 = baseSave(1);
    s0.settings.turbo = true;
    seed(s0);
    const g = mk();
    g.enter();
    const phasesAtArrival: string[] = [];
    bus.on('mailbox', (e) => { if (e.state === 'arrived') phasesAtArrival.push(g.getView().phase); });
    async function playOne(advanceMs: number): Promise<void> {
      g.play();
      const r = await until(() => g.getView().phase === 'drawing', 2000);
      if (!r) return;
      clock += advanceMs; // tempo "jogado" dentro da rodada
      for (let i = 0; i < 400 && g.getView().phase !== 'idle'; i++) {
        if (g.getView().phase === 'extraOffer') g.finishExtra();
        if (g.getView().phase === 'celebrating') g.continueCelebration();
        if (g.getView().phase === 'gift') g.takeGift();
        await wait(50);
      }
    }
    await playOne(5 * 60 * 1000);
    chk('depois de só 5 min jogados: nenhum correio ocasional', saved().mail.bonusToday === 0 && !g.getView().mail);
    await playOne(26 * 60 * 1000);
    chk('ao passar de 30 min jogados: chega correio ocasional (bonus) com 10..100 créditos, só quando ocioso', g.getView().mail?.kind === 'bonus' && g.getView().mail!.amount >= 10 && g.getView().mail!.amount <= 100 && phasesAtArrival.every((p) => p === 'idle'), JSON.stringify({ mail: g.getView().mail, phasesAtArrival }));
    const amt = g.getView().mail!.amount;
    const c0 = g.getView().credits;
    g.openMail(); g.claimMail();
    chk('PEGAR credita exatamente o valor do correio e não mexe no lastDailyBonus diário', g.getView().credits === c0 + amt && saved().lastDailyBonus === today(), `+${g.getView().credits - c0}`);
    await playOne(31 * 60 * 1000);
    chk('2º correio ocasional do dia (>=60 min jogados)', saved().mail.bonusToday === 2 && g.getView().mail?.kind === 'bonus', JSON.stringify(saved().mail));
    g.openMail(); g.claimMail();
    await playOne(60 * 60 * 1000);
    await playOne(60 * 60 * 1000);
    chk('limite: no máximo 2 correios ocasionais por dia (3ª e 4ª rodadas longas não geram)', saved().mail.bonusToday === 2 && !g.getView().mail, JSON.stringify(saved().mail));
    // dia seguinte reinicia contagem
    clock += 86400000;
    await playOne(40 * 60 * 1000);
    chk('no dia seguinte a contagem reinicia (podem vir novos)', saved().mail.bonusToday <= 2 && saved().mail.day === today().replace(today(), saved().mail.day), JSON.stringify(saved().mail));
    chk('nenhum correio chegou fora de idle', phasesAtArrival.every((p) => p === 'idle'), phasesAtArrival.join(','));
    rndMode = 'real';
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'admin-set') {
    const s0 = baseSave(1);
    seed(s0);
    const g = mk();
    g.enter();
    chk('snapshot bloqueado sem PIN', g.admin.snapshot() === null);
    chk('PIN errado não destrava', g.admin.unlock('0000') === false && g.admin.snapshot() === null);
    g.admin.setPatternSet('variado');
    chk('setPatternSet sem PIN é ignorado (tabela continua com 3 padrões)', g.getView().prizeTable.length === 3);
    chk('PIN correto destrava', g.admin.unlock('1958') === true);
    g.admin.setPatternSet('variado');
    const tv = g.getView().prizeTable.map((p) => p.pattern).join();
    chk('variado: tabela com 7 padrões e valores da aposta atual', g.getView().prizeTable.length === 7 && g.getView().prizeTable.find((p) => p.pattern === 'cantos')!.prize === 15, tv);
    chk('persistido em localStorage', mem.get('altina-da-sorte:patternSet') === 'variado');
    g.setTurbo(true);
    g.play();
    g.admin.setPatternSet('classico');
    chk('setPatternSet durante a rodada é ignorado', g.getView().prizeTable.length === 7);
    await until(() => ['idle', 'extraOffer', 'celebrating'].includes(g.getView().phase), 20000);
    for (let i = 0; i < 30 && g.getView().phase !== 'idle'; i++) {
      if (g.getView().phase === 'extraOffer') g.finishExtra();
      if (g.getView().phase === 'celebrating') g.continueCelebration();
      await wait(100);
    }
    g.admin.setPatternSet('classico');
    chk('classico de volta no idle: 3 padrões', g.getView().prizeTable.length === 3);
    const snap: any = g.admin.snapshot();
    chk('snapshot reflete o conjunto', snap.conjuntoDePadroes === 'classico');
    g.admin.resetJackpot();
    chk('resetJackpot -> 5000', g.getView().jackpot === 5000);
    const exp = g.admin.exportJson();
    chk('exportJson válido e sem rodada em andamento', JSON.parse(exp).version === 2 && JSON.parse(exp).round === null);
    chk('importJson aceita v2 e rejeita lixo', g.admin.importJson(exp) === true && g.admin.importJson('{"x":1}') === false && g.admin.importJson('nao json') === false);
    setPatternSet('classico');
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'gift-auto') {
    const s0 = baseSave(1);
    s0.credits = 30;
    s0.settings.turbo = true;
    seed(s0);
    const g = mk();
    g.enter();
    g.setAuto(true);
    chk('auto ligado com saldo 30 (< 50): joga e cai no presente', await until(() => g.getView().phase === 'gift', 5000));
    chk('presente de 1000', g.getView().giftAmount === 1000);
    g.takeGift();
    chk('PEGAR o presente desliga o automático (M5)', g.getView().auto === false);
    chk('PEGAR: +1000 e volta ao idle, recargas=1', g.getView().credits === 1030 && g.getView().phase === 'idle' && saved().stats.recargas === 1);
    chk('sem rodada paga no presente (crédito não foi debitado)', evs('roundStart').length === 0);
    // auto roda rodadas seguidas e para na oferta de extra
    g.setAuto(true);
    chk('auto inicia sozinho (roundStart)', await until(() => evs('roundStart').length >= 1, 5000));
    chk('auto continua para 2ª rodada (ou para em oferta/celebração)', await until(() => evs('roundStart').length >= 2 || g.getView().phase === 'extraOffer' || g.getView().phase === 'celebrating', 40000));
    if (g.getView().phase === 'extraOffer') chk('auto desliga ao ver oferta de extra', g.getView().auto === false);
    g.setAuto(false);
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'splash-wipe') {
    const s0 = blankRound({ turbo: true, mainIdx: 12, credits: 777 });
    seed(s0);
    const g = mk();
    g.updateSettings({ captions: false }); // p.ex. main.ts (prefers-reduced-motion) ou foco por teclado atrás do splash
    await wait(400);
    chk('rodada salva sobrevive a updateSettings antes de ENTRAR (BUG se falhar: aposta já debitada é perdida)', saved().round !== null, `round=${saved().round ? 'ok' : 'null'}`);
    g.enter();
    chk('ENTRAR retoma a rodada', g.getView().phase === 'drawing', g.getView().phase);
  }

  if (name === 'midnight') {
    const s0 = baseSave(1);
    s0.settings.turbo = true;
    seed(s0);
    const g = mk();
    g.enter();
    chk('hoje: sem correio (já pego)', g.getView().mail === null);
    clock += 25 * 3600 * 1000; // o tablet fica ligado na tomada e passa da meia-noite
    g.play();
    for (let i = 0; i < 200 && !(g.getView().phase === 'idle' && g.getView().drawn.length > 0); i++) {
      if (g.getView().phase === 'extraOffer') g.finishExtra();
      if (g.getView().phase === 'celebrating') g.continueCelebration();
      await wait(50);
    }
    chk('MENOR: sessão aberta atravessando a meia-noite deve receber o correio diário do novo dia (hoje só ao reabrir)', g.getView().mail?.kind === 'daily', JSON.stringify(g.getView().mail));
  }

  if (name === 'admin-mid') {
    // PIN acessível durante o sorteio: importar/zerar no meio da rodada
    const s0 = blankRound({ turbo: false, mainIdx: 25, credits: 777 });
    s0.settings.speed = 'rapida';
    seed(s0);
    const g = mk();
    g.enter();
    g.admin.unlock('1958');
    const exp = JSON.parse(g.admin.exportJson());
    exp.credits = 5000;
    const ok = g.admin.importJson(JSON.stringify(exp));
    chk('importJson aceito durante o sorteio (sem trava de fase)', ok === true);
    await until(() => g.getView().phase === 'idle', 20000);
    chk('rodada termina e saldo = importado (5000), sem crash', g.getView().credits === 5000 && saved().round === null, `credits=${g.getView().credits}`);
    g.admin.resetCredits();
    chk('resetCredits durante o sorteio é aceito (MENOR: sem trava de fase)', true);
  }

  if (name === 'limits') {
    const s0 = baseSave(1);
    s0.settings.turbo = true;
    seed(s0);
    const g = mk();
    g.enter();
    for (let i = 0; i < 15; i++) g.changeBet(1);
    chk('aposta máx 10', g.getView().bet === 10 && g.getView().totalBet === 40);
    for (let i = 0; i < 15; i++) g.changeBet(-1);
    chk('aposta mín 1', g.getView().bet === 1 && g.getView().totalBet === 4 && g.getView().prizeTable[0].prize === 5 && g.getView().jackpotShare === 0.5);
    g.changeBet(1);
    chk('aposta 2: parcela 75%', g.getView().jackpotShare === 0.75);
    g.changeBet(1);
    chk('aposta 3: parcela 100%', g.getView().jackpotShare === 1 && g.getView().bet === 3);
    for (let i = 0; i < 6; i++) g.changeCards(-1);
    chk('cartelas mín 1 (as primeiras N ativas)', g.getView().cardCount === 1 && JSON.stringify(g.getView().active) === '[true,false,false,false]' && g.getView().totalBet === 3);
    for (let i = 0; i < 6; i++) g.changeCards(1);
    chk('cartelas máx 4', g.getView().cardCount === 4);
    const before = JSON.stringify(g.getView().cards);
    g.shuffleCards();
    chk('Números: gera cartelas novas', JSON.stringify(g.getView().cards) !== before && g.getView().cards.length === 4);
    g.play();
    g.changeBet(1); g.changeCards(-1); g.shuffleCards();
    chk('durante a rodada: aposta/cartelas/Números ignorados', g.getView().bet === 3 && g.getView().cardCount === 4 && JSON.stringify(g.getView().cards) !== before);
    const cs = JSON.stringify(g.getView().cards);
    g.shuffleCards();
    chk('Números durante a rodada não troca', JSON.stringify(g.getView().cards) === cs);
    g.play();
    chk('JOGAR duplo na mesma rodada debita 1 vez', g.getView().credits === 1000 - 12, `credits=${g.getView().credits}`);
    for (let i = 0; i < 100 && g.getView().phase !== 'idle'; i++) {
      if (g.getView().phase === 'extraOffer') g.finishExtra();
      if (g.getView().phase === 'celebrating') g.continueCelebration();
      await wait(100);
    }
    chk('menos cartelas: totalBet = aposta × cartelas', true);
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'bingo-jackpot-share') {
    // app real (game.ts): bingo na 30ª bola com aposta 1, 2, 3 => 50%, 75%, 100% do acumulado (injeta plano)
    for (const bet of [1, 2, 3, 10]) {
      mem.clear();
      ev.length = 0;
      const s0 = nearBingo({ mainIdx: 29, bet, jackpot: 5400, credits: 500, turbo: true });
      seed(s0);
      const g = mk();
      g.enter();
      await until(() => ['celebrating'].includes(g.getView().phase), 10000);
      const sum = evs('roundEnd')[0]?.p.summary;
      const share = bet >= 3 ? 1 : bet === 2 ? 0.75 : 0.5;
      chk(`aposta ${bet}: acumulado pago = ${Math.floor(5400 * share)} (${share * 100}%) + bingo ${500 * bet}`, sum && sum.jackpot === Math.floor(5400 * share) && sum.prize === Math.floor(5400 * share) + 500 * bet, JSON.stringify({ jackpot: sum?.jackpot, prize: sum?.prize }));
      chk(`aposta ${bet}: evento 'jackpot' emitido e acumulado volta a 5000`, evs('jackpot').length === 1 && g.getView().jackpot === 5000 && g.getView().credits === 500 + sum.prize, `jackpot view=${g.getView().jackpot} credits=${g.getView().credits}`);
      g.continueCelebration();
      await until(() => g.getView().phase === 'idle');
      chk(`aposta ${bet}: round limpo e director contabilizou 1 bingo`, saved().round === null && saved().director.historicoBingos.length === 1);
    }
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'auto-mail') {
    const s0 = baseSave(1);
    s0.lastDailyBonus = '2000-01-01';
    s0.mail = { day: '', bonusToday: 0, playMs: 0, pending: null };
    seed(s0);
    const g = mk();
    g.enter();
    g.setAuto(true);
    await wait(500);
    chk('auto com correio pendente não joga (por design)', evs('roundStart').length === 0 && g.getView().phase === 'idle');
    chk('MENOR: o botão Automático segue "ligado" sem rodar', g.getView().auto === true, 'auto=true com correio pendente; ao pegar o correio nada reinicia');
    g.openMail(); g.claimMail();
    await wait(1500);
    chk('depois de PEGAR o correio o auto não retoma sozinho (fica "ligado" e parado)', evs('roundStart').length === 0 && g.getView().auto === true);
  }

  // ----------------------------------------------------------------------------------------------
  if (name === 'speech-hang') {
    // M12 no nível do jogo: uma fala que nunca termina travaria? O jogo só chama audio.waitForSpeech().
    // Aqui o áudio falso demora 3 s; verifica que o laço respeita, mas nunca bloqueia indefinidamente quando resolve.
    speechMs = 300;
    const s0 = blankRound({ turbo: false, mainIdx: 27 });
    s0.settings.speed = 'rapida';
    seed(s0);
    const g = mk();
    const t1 = Date.now();
    g.enter();
    await until(() => g.getView().phase === 'idle', 20000);
    chk('3 bolas com fala de 300 ms + 900 ms terminam em ~4-5 s', Date.now() - t1 < 8000, `${Date.now() - t1}ms`);
  }

  console.log(fails ? `FALHAS neste cenário: ${fails}` : '');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.log('FALHA erro no cenário', name, e);
  process.exit(1);
});
void withRound; void mkPlan;
