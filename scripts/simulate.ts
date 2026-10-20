/* Simulador do Diretor: `npm run simulate [-- --seeds N --days D]`.
 * Política da jogadora: compra toda bola extra oferecida (se tiver saldo), aposta 5 x 4 cartelas,
 * saldo inicial 1000, presente de 1000 quando saldo < 50 ou < aposta total. */
import type { PatternId, DirectorState } from '../src/types';
import { PATTERN_ORDER } from '../src/types';
import { START_CREDITS, GIFT_AMOUNT, GIFT_THRESHOLD, JACKPOT_BASE, TUNING } from '../src/config';
import { seededRng } from '../src/rng';
import { generateCards } from '../src/cards';
import { RoundSession } from '../src/round';
import { nextJackpot } from '../src/payout';
import { DAY_MS, afterRound, initialDirector, monthKey, planRound } from '../src/director';

declare const process: { argv: string[] };
function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}
const BET = 5;
const ACTIVE = [true, true, true, true];
const ONLY = arg('profile', 0);
const PROFILES = ONLY ? [ONLY] : [10, 40, 120];

const DAYS = arg('days', 90);
const SEEDS = arg('seeds', 30);
const START = new Date(2026, 9, 20, 9, 0, 0).getTime(); // 20/10/2026
const END = START + DAYS * DAY_MS;

interface Run {
  rounds: number;
  bets: number;
  common: number;
  bingoPrize: number;
  extraCost: number;
  offers: number;
  roundsWithBingo: number;
  perCard: Partial<Record<PatternId, number>>;
  perRoundBest: Partial<Record<PatternId, number>>;
  noPrize: number;
  recargas: number;
  minCredits: number;
  finalCredits: number;
  weekly: number[];
  bingoTimes: number[];
  months: Record<string, number>;
  jackpotsPaid: number;
}

function runOne(rpd: number, seed: number): Run {
  const rng = seededRng(seed * 7919 + rpd * 104729 + 17);
  let director: DirectorState = initialDirector(START);
  let credits = START_CREDITS;
  let jackpot = JACKPOT_BASE;
  const run: Run = {
    rounds: 0, bets: 0, common: 0, bingoPrize: 0, extraCost: 0, offers: 0, roundsWithBingo: 0,
    perCard: {}, perRoundBest: {}, noPrize: 0, recargas: 0, minCredits: credits, finalCredits: credits,
    weekly: [], bingoTimes: [], months: {}, jackpotsPaid: 0,
  };
  let cards = generateCards(rng);
  for (let day = 0; day < DAYS; day++) {
    for (let r = 0; r < rpd; r++) {
      const now = START + day * DAY_MS + Math.floor(((r + 0.5) / rpd) * 12 * 3_600_000);
      if (run.rounds % 8 === 0) cards = generateCards(rng);
      const totalBet = BET * ACTIVE.length;
      if (credits < GIFT_THRESHOLD || credits < totalBet) {
        credits += GIFT_AMOUNT;
        run.recargas++;
      }
      credits -= totalBet;
      const { plan } = planRound({ cards, active: ACTIVE, bet: BET, now, director, rng });
      const s = new RoundSession(cards, ACTIVE, BET, jackpot, plan);
      while (s.nextMain()) { /* 30 bolas */ }
      let cost = s.offerCost();
      if (cost > 0) run.offers++;
      while (cost > 0 && cost <= credits) {
        credits -= cost;
        s.buyExtra();
        cost = s.offerCost();
      }
      const sum = s.finish();
      credits += sum.prize;
      run.rounds++;
      run.bets += totalBet;
      run.extraCost += sum.extraCost;
      let hadBingo = false;
      let common = 0;
      for (const res of sum.results) {
        if (res.pattern) run.perCard[res.pattern] = (run.perCard[res.pattern] ?? 0) + 1;
        if (res.pattern === 'bingo') hadBingo = true;
        else common += res.prize;
      }
      run.common += common;
      run.bingoPrize += sum.prize - common;
      if (sum.best) run.perRoundBest[sum.best] = (run.perRoundBest[sum.best] ?? 0) + 1;
      else run.noPrize++;
      if (sum.jackpot > 0) {
        run.jackpotsPaid++;
        jackpot = JACKPOT_BASE;
      } else {
        jackpot = nextJackpot(jackpot, totalBet);
      }
      if (hadBingo) {
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
const names: (PatternId)[] = PATTERN_ORDER;

console.log(`Simulação: ${DAYS} dias a partir de ${new Date(START).toLocaleDateString('pt-BR')}, aposta ${BET} x ${ACTIVE.length} cartelas, ${SEEDS} seeds por perfil`);
console.log(`Metas: ${TUNING.bingoPorMesAlvo} bingos/mês (máx ${TUNING.bingoMaxPorMes}), mín ${TUNING.diasMinEntreBingos} dias entre bingos, RTP comuns alvo ${TUNING.rtpAlvo}\n`);

const cov = monthsCovered();
let violations = 0;

for (const rpd of PROFILES) {
  const runs: Run[] = [];
  for (let s = 1; s <= SEEDS; s++) runs.push(runOne(rpd, s));
  const sum = (fn: (r: Run) => number) => runs.reduce((a, r) => a + fn(r), 0);
  console.log(`=== Perfil ${rpd} rodadas/dia ===`);

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
  console.log(`  primeiro bingo (dias após primeiro uso): média ${f(firsts.reduce((a, b) => a + b, 0) / firsts.length, 1)}, máx ${f(Math.max(...firsts), 1)}`);
  console.log(`  bingos em ${DAYS} dias por seed: média ${f(sum((r) => r.bingoTimes.length) / runs.length)}, jackpots pagos/seed: ${f(sum((r) => r.jackpotsPaid) / runs.length)}`);

  // RTP
  const bets = sum((r) => r.bets);
  const common = sum((r) => r.common);
  const bingo = sum((r) => r.bingoPrize);
  const extra = sum((r) => r.extraCost);
  console.log(`  RTP comuns (prêmios comuns / apostas): ${f(common / bets, 3)} | líquido do custo das extras (/ apostas+extras): ${f(common / (bets + extra), 3)}`);
  console.log(`  RTP total (com bingo e acumulado / apostas): ${f((common + bingo) / bets, 3)} | custo médio de extras por rodada: ${f(extra / sum((r) => r.rounds), 2)} (aposta ${BET * 4})`);
  const rounds = sum((r) => r.rounds);
  console.log(`  rodadas com oferta de bola extra: ${pct(sum((r) => r.offers) / rounds)} | rodadas sem prêmio: ${pct(sum((r) => r.noPrize) / rounds)}`);

  // padrões
  const pc = names.map((p) => `${p} ${pct(sum((r) => r.perCard[p] ?? 0) / (rounds * 4), 2)}`).join(' | ');
  console.log(`  frequência por cartela: ${pc}`);
  const pr = names.map((p) => `${p} ${pct(sum((r) => r.perRoundBest[p] ?? 0) / rounds, 2)}`).join(' | ');
  console.log(`  melhor padrão da rodada: ${pr}`);

  // saldo
  const wk = (i: number) => f(runs.reduce((a, r) => a + (r.weekly[i] ?? 0), 0) / runs.length, 0);
  const weeks = [0, 2, 4, 8, runs[0].weekly.length - 1].filter((v, i, a) => a.indexOf(v) === i && v < runs[0].weekly.length);
  console.log(`  saldo médio ao fim das semanas ${weeks.map((w) => w + 1).join(', ')}: ${weeks.map(wk).join(' | ')}`);
  console.log(`  saldo final médio ${f(sum((r) => r.finalCredits) / runs.length, 0)} (mín visto ${f(Math.min(...runs.map((r) => r.minCredits)), 0)}); recargas por seed: média ${f(sum((r) => r.recargas) / runs.length, 1)}, máx ${Math.max(...runs.map((r) => r.recargas))}\n`);
}

console.log(violations === 0 ? 'OK: nenhum mês completo com 0 bingos, nenhum mês com 4+, nenhum intervalo < mínimo.' : `ATENÇÃO: ${violations} violação(ões) (0 em mês completo, 4+ em algum mês ou intervalo curto).`);
