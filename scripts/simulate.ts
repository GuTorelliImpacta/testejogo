/* Simulador do Diretor: `npm run simulate [-- --seeds N --days D --profile R --set classico|variado]`.
 *
 * Política da jogadora: compra toda bola extra oferecida (as grátis sempre; as pagas se tiver saldo),
 * saldo inicial 1000, presente de 1000 quando saldo < 50 ou < aposta total, 4 cartelas, cartelas novas
 * ("Números") a cada 8 rodadas. Perfis de 10/40/120 rodadas por dia, 90 dias, 30 seeds.
 *
 * Definições (explícitas):
 *   apostas        = soma das apostas das cartelas (aposta x cartelas ativas) de todas as rodadas;
 *   extras pagas   = soma do custo das bolas extras NÃO grátis, em rodadas que NÃO terminaram em bingo
 *                    (o custo das extras de uma rodada de bingo é do bingo, não do prêmio comum);
 *   prêmios comuns = prêmios por cartela (Linha, Linha dupla...), exceto Bingo e Acumulado;
 *   RTP comuns     = prêmios comuns / (apostas + extras pagas)   <- meta ~0,88;
 *   oferta         = cada vez que o jogo oferece a próxima bola extra; grátis = oferta com plan.free;
 *   "com Linha"    = rodada em que pelo menos uma cartela termina com Linha como melhor padrão.
 */
import type { PatternId, DirectorState } from '../src/types';
import { PATTERN_ORDER } from '../src/types';
import {
  START_CREDITS, GIFT_AMOUNT, GIFT_THRESHOLD, JACKPOT_BASE, TUNING, jackpotShare,
  setPatternSet, activePatterns,
} from '../src/config';
import type { PatternSetName } from '../src/config';
import { seededRng } from '../src/rng';
import { generateCards } from '../src/cards';
import { RoundSession } from '../src/round';
import { nextJackpot } from '../src/payout';
import { DAY_MS, afterRound, initialDirector, monthKey, planRound } from '../src/director';

declare const process: { argv: string[]; exitCode?: number };
function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}
function argStr(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const SET = argStr('set', 'classico') as PatternSetName;
setPatternSet(SET);
const BET = arg('bet', 5);
const ACTIVE = [true, true, true, true];
const NCARDS = ACTIVE.length;
const ONLY = arg('profile', 0);
const PROFILES = ONLY ? [ONLY] : [10, 40, 120];

const DAYS = arg('days', 90);
const SEEDS = arg('seeds', 30);
const START = new Date(2026, 9, 20, 9, 0, 0).getTime(); // 20/10/2026
const END = START + DAYS * DAY_MS;

interface Run {
  bet: number;
  rounds: number;
  bets: number;
  common: number;
  bingoPrize: number; // Bingo (cartela) + Acumulado
  extraPaid: number; // extras pagas em rodadas SEM bingo (entram no RTP dos prêmios comuns)
  extraPaidBingo: number; // extras pagas em rodadas que terminaram em bingo (custo do bingo)
  offersRounds: number; // rodadas com pelo menos uma oferta
  offers: number; // ofertas (cada bola extra oferecida)
  freeOffers: number;
  roundsWithBingo: number;
  perCard: Partial<Record<PatternId, number>>;
  perRoundBest: Partial<Record<PatternId, number>>;
  roundsWithLinha: number; // >= 1 cartela com Linha como melhor padrão
  roundsWithDupla: number; // >= 1 cartela com Linha dupla
  noPrize: number;
  recargas: number;
  minCredits: number;
  finalCredits: number;
  weekly: number[];
  bingoTimes: number[];
  months: Record<string, number>;
  jackpotsPaid: number;
  jackpotSum: number;
  bingoMain: number;
  bingoExtra: number;
}

function runOne(rpd: number, seed: number, bet: number): Run {
  const rng = seededRng(seed * 7919 + rpd * 104729 + bet * 31 + 17);
  let director: DirectorState = initialDirector(START);
  let credits = START_CREDITS;
  let jackpot = JACKPOT_BASE;
  const run: Run = {
    bet, rounds: 0, bets: 0, common: 0, bingoPrize: 0, extraPaid: 0, extraPaidBingo: 0, offersRounds: 0, offers: 0, freeOffers: 0,
    roundsWithBingo: 0, perCard: {}, perRoundBest: {}, roundsWithLinha: 0, roundsWithDupla: 0, noPrize: 0,
    recargas: 0, minCredits: credits, finalCredits: credits, weekly: [], bingoTimes: [], months: {},
    jackpotsPaid: 0, jackpotSum: 0, bingoMain: 0, bingoExtra: 0,
  };
  let cards = generateCards(rng);
  for (let day = 0; day < DAYS; day++) {
    for (let r = 0; r < rpd; r++) {
      const now = START + day * DAY_MS + Math.floor(((r + 0.5) / rpd) * 12 * 3_600_000);
      if (run.rounds % 8 === 0) cards = generateCards(rng);
      const totalBet = bet * NCARDS;
      if (credits < GIFT_THRESHOLD || credits < totalBet) {
        credits += GIFT_AMOUNT;
        run.recargas++;
      }
      credits -= totalBet;
      const { plan } = planRound({ cards, active: ACTIVE, bet, now, director, rng });
      const s = new RoundSession(cards, ACTIVE, bet, jackpot, plan);
      while (s.nextMain()) { /* 30 bolas */ }
      let offeredRound = false;
      for (let o = s.offer(); o; o = s.offer()) {
        if (!o.free && o.cost > credits) break; // sem saldo: termina
        offeredRound = true;
        run.offers++;
        if (o.free) run.freeOffers++;
        credits -= o.cost;
        s.buyExtra();
      }
      if (offeredRound) run.offersRounds++;
      const sum = s.finish();
      credits += sum.prize;
      run.rounds++;
      run.bets += totalBet;
      let hadBingo = false;
      let common = 0;
      let linha = false;
      let dupla = false;
      for (const res of sum.results) {
        if (res.pattern) run.perCard[res.pattern] = (run.perCard[res.pattern] ?? 0) + 1;
        if (res.pattern === 'bingo') hadBingo = true;
        else common += res.prize;
        if (res.pattern === 'linha') linha = true;
        if (res.pattern === 'linhaDupla') dupla = true;
      }
      if (linha) run.roundsWithLinha++;
      if (dupla) run.roundsWithDupla++;
      if (hadBingo) run.extraPaidBingo += sum.extraCost;
      else run.extraPaid += sum.extraCost;
      run.common += common;
      run.bingoPrize += sum.prize - common;
      if (sum.best) run.perRoundBest[sum.best] = (run.perRoundBest[sum.best] ?? 0) + 1;
      else run.noPrize++;
      if (sum.jackpot > 0) {
        run.jackpotsPaid++;
        run.jackpotSum += sum.jackpot;
        jackpot = JACKPOT_BASE;
      } else {
        jackpot = nextJackpot(jackpot, totalBet);
      }
      if (hadBingo) {
        if (sum.jackpot > 0) run.bingoMain++;
        else run.bingoExtra++;
        run.roundsWithBingo++;
        run.bingoTimes.push(now);
        const k = monthKey(now);
        run.months[k] = (run.months[k] ?? 0) + 1;
      }
      director = afterRound(director, now, hadBingo);
      if (credits < run.minCredits) run.minCredits = credits;
    }
    if (day % 7 === 6) run.weekly.push(credits);
  }
  run.finalCredits = credits;
  return run;
}

/** Meses-calendário completamente cobertos pela simulação. */
function monthsCovered(): { key: string; full: boolean }[] {
  const out: { key: string; full: boolean }[] = [];
  const d = new Date(START);
  let y = d.getFullYear();
  let m = d.getMonth();
  for (;;) {
    const first = new Date(y, m, 1).getTime();
    const next = new Date(y, m + 1, 1).getTime();
    if (first >= END) break;
    out.push({ key: monthKey(first), full: first >= START - 12 * 3_600_000 && next <= END });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

const f = (x: number, d = 2) => x.toFixed(d);
const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;
const inRange = (x: number, lo: number, hi: number) => x >= lo && x <= hi;
const names: PatternId[] = PATTERN_ORDER.filter((p) => activePatterns().includes(p));
let metaFalhas = 0;
function meta(label: string, value: number, lo: number, hi: number, asPct = true): void {
  const ok = inRange(value, lo, hi);
  if (!ok) metaFalhas++;
  const fmt = (x: number) => (asPct ? pct(x) : f(x, 3));
  console.log(`  [${ok ? 'OK ' : 'FORA'}] ${label}: ${fmt(value)} (meta ${fmt(lo)}-${fmt(hi)})`);
}

console.log(`Simulação: ${DAYS} dias a partir de ${new Date(START).toLocaleDateString('pt-BR')}, conjunto '${SET}' (${activePatterns().join(', ')}), aposta ${BET} x ${NCARDS} cartelas, ${SEEDS} seeds por perfil`);
console.log(`Metas: ${TUNING.bingoPorMesAlvo} bingos/mês (máx ${TUNING.bingoMaxPorMes}), mín ${TUNING.diasMinEntreBingos} dias entre bingos, RTP comuns alvo ${TUNING.rtpAlvo} (= prêmios comuns / (apostas + extras pagas))\n`);

const cov = monthsCovered();
let violations = 0;

for (const rpd of PROFILES) {
  const runs: Run[] = [];
  for (let s = 1; s <= SEEDS; s++) runs.push(runOne(rpd, s, BET));
  const sum = (fn: (r: Run) => number) => runs.reduce((a, r) => a + fn(r), 0);
  console.log(`=== Perfil ${rpd} rodadas/dia (aposta ${BET}) ===`);

  // meses
  const hist: Record<string, number[]> = {};
  const histPartial: Record<string, number[]> = {};
  for (const { key, full } of cov) {
    const h = [0, 0, 0, 0, 0];
    for (const r of runs) h[Math.min(4, r.months[key] ?? 0)]++;
    (full ? hist : histPartial)[key] = h;
  }
  const line = (k: string, h: number[], tag: string) =>
    console.log(`  ${k} ${tag}: bingos 0:${h[0]} 1:${h[1]} 2:${h[2]} 3:${h[3]} 4+:${h[4]} (de ${runs.length} seeds)`);
  for (const { key, full } of cov) line(key, (full ? hist : histPartial)[key], full ? 'completo' : 'parcial ');
  let mesesBons = 0;
  let mesesTot = 0;
  for (const h of Object.values(hist)) { mesesBons += h[2] + h[3]; mesesTot += h[0] + h[1] + h[2] + h[3] + h[4]; }
  const zeros = Object.values(hist).reduce((a, h) => a + h[0], 0);
  const fours = [...Object.values(hist), ...Object.values(histPartial)].reduce((a, h) => a + h[4], 0);
  const meanFull = Object.values(hist).reduce((a, h) => a + h[1] + 2 * h[2] + 3 * h[3] + 4 * h[4], 0) / Math.max(1, mesesTot);
  console.log(`  meses completos com 2-3 bingos: ${pct(mesesBons / Math.max(1, mesesTot))}; média ${f(meanFull)}/mês; meses com 0: ${zeros}; meses com 4+: ${fours}`);
  violations += zeros + fours;

  // intervalos
  const gaps: number[] = [];
  for (const r of runs) for (let i = 1; i < r.bingoTimes.length; i++) gaps.push((r.bingoTimes[i] - r.bingoTimes[i - 1]) / DAY_MS);
  const firsts = runs.map((r) => (r.bingoTimes.length ? (r.bingoTimes[0] - START) / DAY_MS : Infinity));
  if (gaps.length) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sorted = gaps.slice().sort((a, b) => a - b);
    console.log(`  intervalo entre bingos (dias): média ${f(mean, 1)}, mín ${f(sorted[0], 1)}, mediana ${f(sorted[Math.floor(sorted.length / 2)], 1)}, máx ${f(sorted[sorted.length - 1], 1)}`);
    if (sorted[0] < TUNING.diasMinEntreBingos - 1e-9) { console.log('  !! intervalo abaixo do mínimo'); violations++; }
  }
  const fMin = Math.min(...firsts);
  const fMax = Math.max(...firsts);
  console.log(`  primeiro bingo (dias após primeiro uso): média ${f(firsts.reduce((a, b) => a + b, 0) / firsts.length, 1)}, mín ${f(fMin, 1)}, máx ${f(fMax, 1)} (meta: entre o 3º e o 10º dia => 2 a 10 dias decorridos)`);
  if (fMin < 2 || fMax > 10) { console.log('  !! primeiro bingo fora da janela'); violations++; }
  console.log(`  bingos em ${DAYS} dias por seed: média ${f(sum((r) => r.bingoTimes.length) / runs.length)} (na principal/acumulado ${f(sum((r) => r.bingoMain) / runs.length)}, via extra ${f(sum((r) => r.bingoExtra) / runs.length)})`);

  const rounds = sum((r) => r.rounds);
  const bets = sum((r) => r.bets);
  const common = sum((r) => r.common);
  const bingo = sum((r) => r.bingoPrize);
  const extra = sum((r) => r.extraPaid);

  // metas da v2
  meta('rodadas sem prêmio', sum((r) => r.noPrize) / rounds, 0.55, 0.62);
  meta('rodadas com >= 1 Linha', sum((r) => r.roundsWithLinha) / rounds, 0.30, 0.38);
  meta('rodadas com Linha dupla', sum((r) => r.roundsWithDupla) / rounds, 0.05, 0.08);
  meta('rodadas com oferta de bola extra', sum((r) => r.offersRounds) / rounds, 0.25, 0.35);
  meta('bola grátis / ofertas', sum((r) => r.freeOffers) / Math.max(1, sum((r) => r.offers)), 0.15, 0.20);
  meta('RTP comuns / (apostas + extras pagas)', common / (bets + extra), 0.85, 0.91, false);
  const rec = runs.map((r) => r.recargas);
  const recMean = rec.reduce((a, b) => a + b, 0) / rec.length;
  const recOk = rpd < 120 || recMean <= 20;
  if (!recOk) metaFalhas++;
  console.log(`  [${recOk ? 'OK ' : 'FORA'}] recargas de presente em ${DAYS} dias: média ${f(recMean, 1)}, máx ${Math.max(...rec)}${rpd >= 120 ? ' (meta <= ~20)' : ''}`);

  console.log(`  RTP comuns / apostas (sem somar extras): ${f(common / bets, 3)} | RTP total (comuns + bingo + acumulado) / (apostas + extras): ${f((common + bingo) / (bets + extra), 3)}`);
  console.log(`  extras: ${f(sum((r) => r.offers) / rounds, 2)} ofertas/rodada; custo pago médio ${f(extra / rounds, 2)} por rodada (+ ${f(sum((r) => r.extraPaidBingo) / runs.length, 0)} por seed em rodadas de bingo) (apostas ${BET * NCARDS}); grátis ${sum((r) => r.freeOffers)} de ${sum((r) => r.offers)}`);
  console.log(`  acumulado pago por seed: ${f(sum((r) => r.jackpotsPaid) / runs.length)} vezes, média ${f(sum((r) => r.jackpotSum) / Math.max(1, sum((r) => r.jackpotsPaid)), 0)} créditos (parcela da aposta ${BET}: ${jackpotShare(BET) * 100}%)`);

  // padrões
  const pc = names.map((p) => `${p} ${pct(sum((r) => r.perCard[p] ?? 0) / (rounds * NCARDS), 2)}`).join(' | ');
  console.log(`  frequência por cartela: ${pc}`);
  const pr = names.map((p) => `${p} ${pct(sum((r) => r.perRoundBest[p] ?? 0) / rounds, 2)}`).join(' | ');
  console.log(`  melhor padrão da rodada: ${pr}`);

  // saldo
  const wk = (i: number) => f(runs.reduce((a, r) => a + (r.weekly[i] ?? 0), 0) / runs.length, 0);
  const weeks = [0, 2, 4, 8, runs[0].weekly.length - 1].filter((v, i, a) => a.indexOf(v) === i && v < runs[0].weekly.length);
  console.log(`  saldo médio ao fim das semanas ${weeks.map((w) => w + 1).join(', ')}: ${weeks.map(wk).join(' | ')}`);
  console.log(`  saldo final médio ${f(sum((r) => r.finalCredits) / runs.length, 0)} (mín visto ${f(Math.min(...runs.map((r) => r.minCredits)), 0)}); recargas por seed: média ${f(recMean, 1)}, máx ${Math.max(...rec)}\n`);
}

// Acumulado parcial: apostas 1 e 2 (perfil 40/dia)
if (!argStr('nopartial', '')) {
  console.log('=== Pagamento parcial do acumulado (perfil 40 rodadas/dia) ===');
  for (const b of [1, 2]) {
    const runs: Run[] = [];
    for (let s = 1; s <= SEEDS; s++) runs.push(runOne(40, s, b));
    const sum = (fn: (r: Run) => number) => runs.reduce((a, r) => a + fn(r), 0);
    const rounds = sum((r) => r.rounds);
    const common = sum((r) => r.common);
    const bets = sum((r) => r.bets);
    const extra = sum((r) => r.extraPaid);
    const paid = sum((r) => r.jackpotsPaid);
    console.log(
      `  aposta ${b} (parcela ${jackpotShare(b) * 100}%): bingos/seed ${f(sum((r) => r.roundsWithBingo) / runs.length)}, ` +
      `acumulado pago ${f(paid / runs.length)}x/seed (parcial em ${paid ? '100' : '0'}% dos pagamentos; ${f((1000 * paid) / rounds, 1)} por 1000 rodadas), média ${f(sum((r) => r.jackpotSum) / Math.max(1, paid), 0)} créditos; ` +
      `${pct(paid / Math.max(1, sum((r) => r.roundsWithBingo)))} dos bingos foram na principal; ` +
      `RTP comuns ${f(common / (bets + extra), 3)}; sem prêmio ${pct(sum((r) => r.noPrize) / rounds)}; recargas/seed ${f(sum((r) => r.recargas) / runs.length, 1)}`,
    );
  }
  console.log('');
}

const fail = violations + metaFalhas;
console.log(
  fail === 0
    ? 'OK: todas as metas atendidas.'
    : `ATENÇÃO: ${violations} violação(ões) do bingo (0 em mês completo, 4+ em algum mês, intervalo curto, janela do 1º bingo) e ${metaFalhas} meta(s) da v2 fora da faixa.`,
);
