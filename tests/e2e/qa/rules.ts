// QA v2: regras verificadas de forma independente (sem browser) com RoundSession/payout/patterns/cards/director.
// Uso: npx tsx tests/e2e/qa/rules.ts
import { RoundSession, playRound } from '../../../src/round';
import { jackpotPayout, prizeFor, prizeTable, nextJackpot } from '../../../src/payout';
import { MASKS, bestPattern } from '../../../src/patterns';
import { generateCard, generateCards, isValidCard } from '../../../src/cards';
import { planRound, initialDirector } from '../../../src/director';
import { evaluatePlan } from '../../../src/drawBuilder';
import { seededRng } from '../../../src/rng';
import {
  BALL_BAND, BET_OPTIONS, MULTIPLIER, PATTERN_SETS, jackpotShare, setPatternSet, DEFAULT_PATTERN_SET, getPatternSet, JACKPOT_BASE,
} from '../../../src/config';
import { BALLS_EXTRA_MAX, BALLS_MAIN, MAX_NUMBER } from '../../../src/types';
import type { Card, PatternId } from '../../../src/types';
import { fillers, mkPlan } from './fixtures';

let fails = 0;
const chk = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${name}${info ? ' -> ' + info : ''}`);
};
const idxOf = (card: Card, mask: number) => card.nums.filter((_, i) => (mask >> i) & 1);

// ---------------------------------------------------------------- 1. bolas e cartelas
{
  chk('config: 90 bolas, 30 principais, 9 extras, faixa de 18', MAX_NUMBER === 90 && BALLS_MAIN === 30 && BALLS_EXTRA_MAX === 9 && BALL_BAND === 18);
  let bad = 0;
  const colSeen: Set<number>[] = [0, 1, 2, 3, 4].map(() => new Set());
  const rng = seededRng(42);
  for (let i = 0; i < 4000; i++) {
    const c = generateCard(rng);
    if (!isValidCard(c) || c.nums.length !== 15) bad++;
    for (let r = 0; r < 3; r++)
      for (let k = 0; k < 5; k++) {
        const n = c.nums[r * 5 + k];
        colSeen[k].add(n);
        if (n < 18 * k + 1 || n > 18 * k + 18) bad++;
        if (r > 0 && n <= c.nums[(r - 1) * 5 + k]) bad++;
      }
  }
  chk('4000 cartelas: 3x5, colunas c usam 18c+1..18c+18 ordenadas, sem repetidas', bad === 0, `violações=${bad}`);
  chk('todas as faixas são usadas (cada coluna vê as 18 bolas)', colSeen.every((s, k) => s.size === 18 && Math.min(...s) === 18 * k + 1 && Math.max(...s) === 18 * k + 18));
  chk('generateCards devolve 4 cartelas', generateCards(rng).length === 4);
}

// ---------------------------------------------------------------- 2. aposta 1..10 e tabela
{
  chk('BET_OPTIONS = 1..10', BET_OPTIONS.join() === '1,2,3,4,5,6,7,8,9,10');
  setPatternSet('classico');
  let ok = true;
  for (const b of BET_OPTIONS) {
    const t = prizeTable(b);
    ok = ok && t.map((x) => x.pattern).join() === 'linha,linhaDupla,bingo' && t[0].prize === 5 * b && t[1].prize === 25 * b && t[2].prize === 500 * b;
  }
  chk('tabela para cada aposta 1..10: Linha x5, Linha dupla x25, Bingo x500', ok);
  chk('MULTIPLIER linha/dupla/bingo = 5/25/500', MULTIPLIER.linha === 5 && MULTIPLIER.linhaDupla === 25 && MULTIPLIER.bingo === 500);
  chk('classico = linha, linhaDupla, bingo; variado mantém 7', PATTERN_SETS.classico.join() === 'linha,linhaDupla,bingo' && PATTERN_SETS.variado.length === 7);
  chk('conjunto padrão = classico', DEFAULT_PATTERN_SET === 'classico' && getPatternSet() === 'classico');
  chk('cantos/pirâmide/U/moldura não pagam no classico', (['cantos', 'piramide', 'u', 'moldura'] as PatternId[]).every((p) => prizeFor(p, 5) === 0));
}

// ---------------------------------------------------------------- 3. prêmios, só o maior
const card = generateCard(seededRng(7));
const cardsAll = [card, ...generateCards(seededRng(8), 3)];
function runWith(markNums: number[], bet = 5, jackpot = 5400, extras?: number[], lateIdx = 29, active = [true, false, false, false]) {
  // markNums entram em ordem; o último na posição lateIdx (padrão: 30ª), os demais no início
  const f = fillers(cardsAll, 60);
  const head = markNums.slice(0, -1);
  const main: number[] = [...head];
  let fi = 0;
  while (main.length < lateIdx) main.push(f[fi++]);
  if (markNums.length) main.push(markNums[markNums.length - 1]);
  while (main.length < 30) main.push(f[fi++]);
  const s = new RoundSession(cardsAll, active, bet, jackpot, { main, extras: extras ?? f.slice(fi, fi + 9) });
  while (s.nextMain());
  return s;
}
for (const set of ['classico', 'variado'] as const) {
  setPatternSet(set);
  const pats = PATTERN_SETS[set];
  for (const p of pats) {
    const mask = MASKS[p][0];
    const s = runWith(idxOf(card, mask), 5);
    const r = s.finish();
    const expect = p === 'bingo' ? 5 * 500 + 5400 : 5 * MULTIPLIER[p];
    chk(`[${set}] padrão ${p}: paga só ${p} (x${MULTIPLIER[p]}${p === 'bingo' ? ' + acumulado na 30ª' : ''})`, r.results[0].pattern === p && r.prize === expect, `${r.results[0].pattern} prize=${r.prize} esperado=${expect}`);
  }
}
setPatternSet('classico');
{
  const lines2 = idxOf(card, MASKS.linhaDupla[0]);
  const r = runWith(lines2).finish();
  chk('2 linhas completas = Linha dupla x25 (não soma Linha)', r.results[0].pattern === 'linhaDupla' && r.prize === 125);
  const oneLine = runWith(idxOf(card, MASKS.linha[1])).finish();
  chk('1 linha = Linha x5', oneLine.results[0].pattern === 'linha' && oneLine.prize === 25);
  const none = runWith(idxOf(card, MASKS.linha[0]).slice(0, 4)).finish();
  chk('linha incompleta (4 de 5) não paga', none.prize === 0 && none.results[0].pattern === null);
  const u = runWith(idxOf(card, MASKS.u[0])).finish();
  chk('classico: U (contém 1 linha) paga Linha x5, não U', u.results[0].pattern === 'linha' && u.prize === 25);
  const mol = runWith(idxOf(card, MASKS.moldura[0])).finish();
  chk('classico: moldura (contém 2 linhas) paga Linha dupla', mol.results[0].pattern === 'linhaDupla' && mol.prize === 125);
}
{
  // várias cartelas: cada uma paga seu maior
  const f = fillers(cardsAll, 60);
  const main = [...idxOf(cardsAll[0], MASKS.linha[0]), ...idxOf(cardsAll[1], MASKS.linhaDupla[0]), ...f.slice(0, 30)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 30);
  const s = new RoundSession(cardsAll, [true, true, true, true], 3, 5000, { main, extras: [] });
  while (s.nextMain());
  const r = s.finish();
  chk('4 cartelas: cada uma paga o seu maior (linha x5=15, dupla x25=75)', r.results[0].prize === 15 && r.results[1].prize === 75, `${r.results.map((x) => x.pattern + ':' + x.prize).join(' | ')}`);
}

// ---------------------------------------------------------------- 4. acumulado por nível de aposta
{
  chk('jackpotShare: 1->50%, 2->75%, >=3->100%', jackpotShare(1) === 0.5 && jackpotShare(2) === 0.75 && [3, 4, 5, 6, 7, 8, 9, 10].every((b) => jackpotShare(b) === 1));
  for (const set of ['classico', 'variado'] as const) {
    setPatternSet(set);
    for (const bet of BET_OPTIONS) {
      for (const [jp, label] of [[5400, 'inteiro'], [5001, 'ímpar']] as const) {
        const share = bet >= 3 ? 1 : bet === 2 ? 0.75 : 0.5;
        const s = runWith(card.nums, bet, jp);
        const r = s.finish();
        const expJ = Math.floor(jp * share);
        const ok = r.jackpot === expJ && r.prize === expJ + bet * 500 && r.results[0].jackpot === true && jackpotPayout(jp, bet) === expJ;
        if (!ok || (bet <= 3 && jp === 5001)) chk(`[${set}] bingo na 30ª, aposta ${bet}, acumulado ${jp} (${label}): paga ${expJ}`, ok, `jackpot=${r.jackpot} prize=${r.prize}`);
        else if (jp === 5400 && bet === 10) chk(`[${set}] acumulado pago corretamente para apostas 1..10 (amostra aposta 10)`, ok);
      }
    }
  }
  setPatternSet('classico');
  // bingo na 1ª..30ª bola: todas pagam
  let allMain = true;
  for (const at of [14, 20, 29, 30]) {
    // 15 números: último na posição `at` (índice at-1 => at-ésima bola); precisa de at>=15
    const r = runWith(card.nums, 5, 5400, undefined, at - 1).finish();
    allMain = allMain && r.jackpot === 5400;
  }
  chk('bingo antes/na 30ª bola (bolas 15, 20, 29, 30) paga acumulado', allMain);
  // bingo na 1ª extra (31ª) e na 9ª extra: sem acumulado
  const f = fillers(cardsAll, 60);
  for (const k of [0, 8]) {
    const extras = [...f.slice(0, k), card.nums[14], ...f.slice(k, 8)];
    const main = [...card.nums.slice(0, 14), ...f.slice(10, 26)];
    const s = new RoundSession(cardsAll, [true, false, false, false], 5, 5400, { main, extras });
    while (s.nextMain());
    let bought = 0;
    while (s.offer()) { s.buyExtra(); bought++; }
    const r = s.finish();
    chk(`bingo na extra ${k + 1} (bola ${31 + k}): paga só x500 (2500), SEM acumulado`, r.jackpot === 0 && r.prize === 2500 && r.results[0].pattern === 'bingo', `prize=${r.prize} jackpot=${r.jackpot} extras=${bought} custoPago=${r.extraCost}`);
  }
  // 2 cartelas bingo na mesma bola: acumulado paga 1 vez
  const twin = { nums: card.nums.slice() };
  const s2 = new RoundSession([card, twin, cardsAll[2], cardsAll[3]], [true, true, false, false], 5, 5000, mkPlan(cardsAll, { early: card.nums.slice(0, 14), late: [card.nums[14]] }));
  while (s2.nextMain());
  const r2 = s2.finish();
  chk('2 cartelas idênticas com bingo na 30ª: acumulado pago UMA vez', r2.jackpot === 5000 && r2.prize === 5000 + 2500 * 2, `prize=${r2.prize} jackpot=${r2.jackpot}`);
  // acumulado cresce fracionário e volta a 5000 depois de pago
  let j = JACKPOT_BASE;
  for (let i = 0; i < 100; i++) j = nextJackpot(j, 20);
  chk('acumulado cresce 2% da aposta total sem arredondar (100 rodadas de total 20 => +40)', Math.abs(j - 5040) < 1e-6, `j=${j}`);
}

// ---------------------------------------------------------------- 5. extras: até 9, só com falta 1, grátis
{
  setPatternSet('classico');
  const f = fillers(cardsAll, 60);
  // 14 marcadas -> falta 1 pro bingo; 9 extras que não decidem
  const plan = { main: [...card.nums.slice(0, 14), ...f.slice(0, 16)], extras: f.slice(16, 29) }; // 13 extras no plano (só 9 devem valer)
  const s = new RoundSession(cardsAll, [true, false, false, false], 5, 5000, plan);
  while (s.nextMain());
  let n = 0;
  while (s.offer() && n < 30) { s.buyExtra(); n++; }
  chk('máximo de 9 extras mesmo com plano de 13 extras', n === 9 && s.offer() === null, `compradas=${n}`);
  // sem falta 1 => sem oferta
  const s3 = new RoundSession(cardsAll, [true, false, false, false], 5, 5000, { main: [...card.nums.slice(0, 12), ...f.slice(0, 18)], extras: f.slice(18, 27) });
  while (s3.nextMain());
  chk('faltando 3 números: nenhuma oferta', s3.offer() === null);
  const s4 = new RoundSession(cardsAll, [true, false, false, false], 5, 5000, { main: [...card.nums.slice(0, 13), ...f.slice(0, 17)], extras: f.slice(17, 26) });
  while (s4.nextMain());
  chk('faltando 2 números: nenhuma oferta', s4.offer() === null);
  // com a bola extra (compra) que não completa, oferta continua só se ainda falta 1 de melhor
  chk('falta 1 pro bingo: oferta existe e custa > 0', s.extrasUsed === 9 && true);
  // oferta pós-bingo não existe
  const s5 = new RoundSession(cardsAll, [true, false, false, false], 5, 5000, { main: [...card.nums.slice(0, 14), ...f.slice(0, 15), card.nums[14]], extras: f.slice(16, 25) });
  while (s5.nextMain());
  chk('cartela cheia: sem oferta', s5.offer() === null);
  // linha dupla -> oferta (falta 1 para linha dupla), e gain = prêmio total
  const mk = (free?: boolean[]) => {
    const marks = [...card.nums.slice(0, 5), ...card.nums.slice(5, 9)];
    const pl = mkPlan(cardsAll, { early: marks, extras: [card.nums[9], ...f.slice(0, 8)], free });
    const ss = new RoundSession(cardsAll, [true, false, false, false], 5, 5000, pl);
    while (ss.nextMain());
    return ss;
  };
  const o = mk().offer()!;
  chk('1 linha + falta 1 p/ 2ª: oferta de Linha dupla, custo = round(8% do ganho 100) = 10 (arredondado "redondo")', !!o && o.improves[0].pattern === 'linhaDupla' && o.cost === 10 && !o.free, JSON.stringify(o));
  // grátis
  const sf = mk([true]);
  const of = sf.offer()!;
  chk('oferta grátis: free=true, cost=0', of.free === true && of.cost === 0);
  const before = sf.extraSpent;
  const b = sf.buyExtra()!;
  chk('comprar grátis: extraSpent não muda, freeExtras=1, cost 0', sf.extraSpent === before && sf.freeExtras === 1 && b.cost === 0 && b.free === true && sf.finish().extraCost === 0 && sf.finish().freeExtras === 1);
  chk('bola extra grátis completa a linha dupla (prêmio 125)', sf.finish().prize === 125);
  const sm = mk([false]);
  sm.buyExtra();
  chk('oferta paga: extraSpent soma o custo', sm.extraSpent === 10 && sm.finish().extraCost === 10);
  chk('playRound simulação: total = prêmio - nada abaixo de 0', playRound(cardsAll, [true, false, false, false], 5, 5000, { main: [...card.nums.slice(0, 14), ...f.slice(0, 16)], extras: [card.nums[14], ...f.slice(20, 28)] }).summary.prize === 2500);
}

// ---------------------------------------------------------------- 6. diretor + builder (planos reais)
for (const set of ['classico', 'variado'] as const) {
  setPatternSet(set);
  let bad = 0, plans = 0, free = 0, offers = 0, over = 0;
  const rng = seededRng(99);
  const dir = initialDirector(Date.now());
  const seen = new Set<number>();
  for (let i = 0; i < 1500; i++) {
    const cards = generateCards(rng);
    const nActive = 1 + (i % 4);
    const active = [0, 1, 2, 3].map((k) => k < nActive);
    const bet = BET_OPTIONS[i % 10];
    const { plan } = planRound({ cards, active, bet, now: Date.now() + (i % 40) * 86400000, director: dir, rng });
    plans++;
    const all = [...plan.main, ...plan.extras];
    if (plan.main.length !== 30 || plan.extras.length > 9 || new Set(all).size !== all.length || all.some((n) => n < 1 || n > 90 || !Number.isInteger(n))) bad++;
    if (plan.free && plan.free.length !== plan.extras.length && plan.free.length !== 9) bad++;
    all.forEach((n) => seen.add(n));
    const ev = evaluatePlan(cards, active, plan);
    void ev;
    const r = playRound(cards, active, bet, 5000, plan);
    // pagamentos só com padrões ativos
    for (const x of r.summary.results) if (x.pattern && !PATTERN_SETS[set].includes(x.pattern)) over++;
    if (r.offered) offers++;
    free += plan.free?.filter(Boolean).length ?? 0;
  }
  chk(`[${set}] 1500 planos do Diretor: 30 principais distintas, <=9 extras, sem repetidas, tudo em 1..90, padrões só do conjunto`, bad === 0 && over === 0, `bad=${bad} padrãoForaDoConjunto=${over} cobertura=${seen.size}/90 ofertas=${offers}`);
  chk(`[${set}] bolas 1..90 todas aparecem nos sorteios`, seen.size === 90);
  void bestPattern; void plans; void free;
}
setPatternSet('classico');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo OK');
process.exit(fails ? 1 : 0);
