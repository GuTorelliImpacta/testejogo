/* Simulador do Diretor: `npm run simulate [-- --seeds N --days D --profile R --set classico|variado --preset <nome>|all]`.
 * Presets: padrao, bingo1, bingo2, bingo23, bingo34, premios-menos, premios-mais, extra-menos, extra-mais,
 * gratis-menos, gratis-mais, extra-barata (cada um imprime as próprias metas com [OK]/[FORA]; `all` roda todos
 * e termina com uma tabela-resumo).
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
  START_CREDITS, GIFT_AMOUNT, GIFT_THRESHOLD, JACKPOT_BASE, TUNING, DEFAULT_TUNING, jackpotShare,
  setPatternSet, activePatterns,
} from '../src/config';
import type { PatternSetName } from '../src/config';
import { seededRng } from '../src/rng';
import { generateCards } from '../src/cards';
import { RoundSession } from '../src/round';
import { nextJackpot } from '../src/payout';
import type { RuntimeTuning } from '../src/types';
import { DAY_MS, afterRound, initialDirector, monthKey, planRound, resolveTuning } from '../src/director';
import type { ResolvedTuning } from '../src/director';

declare const process: { argv: string[]; exitCode?: number; exit(code?: number): never };
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

interface PresetDef {
  tuning: RuntimeTuning;
  /** Metas de bingo por mês (meses completos): faixa e fração mínima. */
  bingo: { lo: number; hi: number; share: number; strict: boolean };
  noPrize: [number, number];
  linha: [number, number];
  dupla: [number, number];
  ofertas: [number, number];
  gratis: [number, number];
  rtp: [number, number];
  descr: string;
}
const T0 = DEFAULT_TUNING;
const BASE = {
  bingo: { lo: 2, hi: 3, share: 0, strict: true },
  noPrize: [0.55, 0.62], linha: [0.30, 0.38], dupla: [0.05, 0.08], ofertas: [0.25, 0.35], gratis: [0.15, 0.20], rtp: [0.85, 0.91],
} as Omit<PresetDef, 'tuning' | 'descr'>;
const PRESETS: Record<string, PresetDef> = {
  padrao: { ...BASE, tuning: T0, descr: 'padrão (metas v2)' },
  bingo23: { ...BASE, tuning: { ...T0, bingosPorMes: '2-3' }, descr: 'bingos 2 a 3 por mês (metas v2)' },
  bingo1: { ...BASE, bingo: { lo: 1, hi: 1, share: 0.9, strict: false }, tuning: { ...T0, bingosPorMes: '1' }, descr: '1 bingo/mês em >= 90% dos meses completos' },
  bingo2: { ...BASE, bingo: { lo: 2, hi: 2, share: 0.9, strict: false }, tuning: { ...T0, bingosPorMes: '2' }, descr: '2 bingos/mês em >= 90% dos meses completos' },
  bingo34: { ...BASE, bingo: { lo: 3, hi: 4, share: 0.9, strict: false }, tuning: { ...T0, bingosPorMes: '3-4' }, descr: '3-4 bingos/mês em >= 90%, intervalo >= 5 dias' },
  'premios-menos': { ...BASE, noPrize: [0.60, 0.66], linha: [0.30, 0.37], dupla: [0.04, 0.065], rtp: [0.77, 0.83], tuning: { ...T0, premiosDoDia: 'menos' }, descr: 'prêmios do dia a dia: menos (RTP comum ~0,80)' },
  'premios-mais': { ...BASE, noPrize: [0.52, 0.58], linha: [0.36, 0.42], dupla: [0.06, 0.09], rtp: [0.92, 0.98], tuning: { ...T0, premiosDoDia: 'mais' }, descr: 'prêmios do dia a dia: mais (RTP comum ~0,95)' },
  'extra-menos': { ...BASE, noPrize: [0.57, 0.64], ofertas: [0.12, 0.18], tuning: { ...T0, ofertaExtra: 'menos' }, descr: 'oferta de bola extra: menos (~15%)' },
  'extra-mais': { ...BASE, noPrize: [0.55, 0.62], ofertas: [0.36, 0.44], tuning: { ...T0, ofertaExtra: 'mais' }, descr: 'oferta de bola extra: mais (~40%)' },
  'gratis-menos': { ...BASE, gratis: [0.06, 0.10], tuning: { ...T0, chanceGratis: 'menos' }, descr: 'bola grátis: menos (~8% das ofertas)' },
  'gratis-mais': { ...BASE, gratis: [0.26, 0.34], tuning: { ...T0, chanceGratis: 'mais' }, descr: 'bola grátis: mais (~30% das ofertas)' },
  'extra-barata': { ...BASE, noPrize: [0.57, 0.65], tuning: { ...T0, custoExtra: 'barata' }, descr: 'bola extra mais barata (custo 4%)' },
};
let CFG: ResolvedTuning = resolveTuning(T0);
let TUN: RuntimeTuning = T0;

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
      const { plan } = planRound({ cards, active: ACTIVE, bet, now, director, rng, tuning: TUN });
      const s = new RoundSession(cards, ACTIVE, bet, jackpot, plan, 0, CFG.costFactor);
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

const cov = monthsCovered();

interface Summary { name: string; fails: number; share: number; mean: number; gapMin: number; rtp: number; noPrize: number; linha: number; dupla: number; ofertas: number; gratis: number; recargas: number }

function runPreset(name: string): Summary {
  const def = PRESETS[name];
  TUN = def.tuning;
  CFG = resolveTuning(TUN);
  let violations = 0;
  metaFalhas = 0;
  const all: Run[] = [];
  const sh: number[] = [];
  const means: number[] = [];
  let gapMin = Infinity;
  let recMax = 0;

  console.log(`########## Preset '${name}': ${def.descr}`);
  console.log(`Simulação: ${DAYS} dias a partir de ${new Date(START).toLocaleDateString('pt-BR')}, conjunto '${SET}' (${activePatterns().join(', ')}), aposta ${BET} x ${NCARDS} cartelas, ${SEEDS} seeds por perfil`);
  console.log(`Metas: ${CFG.bingoPorMesAlvo} bingos/mês (máx ${CFG.bingoMaxPorMes}), mín ${CFG.diasMinEntreBingos} dias entre bingos, RTP comuns ${f(def.rtp[0])}-${f(def.rtp[1])} (= prêmios comuns / (apostas + extras pagas)), custo da extra ${CFG.costFactor * 100}%, config ${JSON.stringify(TUN)}\n`);

  for (const rpd of PROFILES) {
    const runs: Run[] = [];
    for (let s = 1; s <= SEEDS; s++) runs.push(runOne(rpd, s, BET));
    all.push(...runs);
    const sum = (fn: (r: Run) => number) => runs.reduce((a, r) => a + fn(r), 0);
    console.log(`=== Perfil ${rpd} rodadas/dia (aposta ${BET}) ===`);

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
    const B = def.bingo;
    let bons = 0;
    let tot = 0;
    for (const h of Object.values(hist)) {
      for (let n = 0; n <= 4; n++) { tot += h[n]; if (n >= B.lo && n <= B.hi) bons += h[n]; }
    }
    const share = bons / Math.max(1, tot);
    const zeros = Object.values(hist).reduce((a, h) => a + h[0], 0);
    const over = [...Object.values(hist), ...Object.values(histPartial)].reduce((a, h) => a + h.reduce((x, v, n) => x + (n > CFG.bingoMaxPorMes ? v : 0), 0), 0);
    const meanFull = Object.values(hist).reduce((a, h) => a + h[1] + 2 * h[2] + 3 * h[3] + 4 * h[4], 0) / Math.max(1, tot);
    sh.push(share);
    means.push(meanFull);
    console.log(`  meses completos com ${B.lo}-${B.hi} bingos: ${pct(share)}; média ${f(meanFull)}/mês; meses com 0: ${zeros}; meses acima do máximo (${CFG.bingoMaxPorMes}): ${over}`);
    if (B.strict) violations += zeros + over;
    else {
      const ok = share >= B.share;
      console.log(`  [${ok ? 'OK ' : 'FORA'}] ${B.lo}-${B.hi} bingos/mês em >= ${pct(B.share, 0)} dos meses completos: ${pct(share)}`);
      if (!ok) violations++;
      if (over > 0) violations++;
    }

    const gaps: number[] = [];
    for (const r of runs) for (let i = 1; i < r.bingoTimes.length; i++) gaps.push((r.bingoTimes[i] - r.bingoTimes[i - 1]) / DAY_MS);
    const firsts = runs.map((r) => (r.bingoTimes.length ? (r.bingoTimes[0] - START) / DAY_MS : Infinity));
    if (gaps.length) {
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const sorted = gaps.slice().sort((a, b) => a - b);
      gapMin = Math.min(gapMin, sorted[0]);
      console.log(`  intervalo entre bingos (dias): média ${f(mean, 1)}, mín ${f(sorted[0], 1)}, mediana ${f(sorted[Math.floor(sorted.length / 2)], 1)}, máx ${f(sorted[sorted.length - 1], 1)}`);
      if (sorted[0] < CFG.diasMinEntreBingos - 1e-9) { console.log('  !! intervalo abaixo do mínimo'); violations++; }
    }
    const fMin = Math.min(...firsts);
    const fMax = Math.max(...firsts);
    const lo1 = Math.max(0, CFG.diasMinEntreBingos - 5) - 1e-9;
    const hi1 = name === 'padrao' || name === 'bingo23' ? 10 : CFG.diasForcarBingo - 5 + 5;
    console.log(`  primeiro bingo (dias após primeiro uso): média ${f(firsts.reduce((a, b) => a + b, 0) / firsts.length, 1)}, mín ${f(fMin, 1)}, máx ${f(fMax, 1)} (janela ${name === 'padrao' || name === 'bingo23' ? 2 : f(lo1 + 1e-9, 0)} a ${hi1})`);
    if (fMin < (name === 'padrao' || name === 'bingo23' ? 2 : lo1) || fMax > hi1) { console.log('  !! primeiro bingo fora da janela'); violations++; }
    console.log(`  bingos em ${DAYS} dias por seed: média ${f(sum((r) => r.bingoTimes.length) / runs.length)} (na principal/acumulado ${f(sum((r) => r.bingoMain) / runs.length)}, via extra ${f(sum((r) => r.bingoExtra) / runs.length)})`);

    const rounds = sum((r) => r.rounds);
    const bets = sum((r) => r.bets);
    const common = sum((r) => r.common);
    const bingo = sum((r) => r.bingoPrize);
    const extra = sum((r) => r.extraPaid);

    meta('rodadas sem prêmio', sum((r) => r.noPrize) / rounds, ...def.noPrize);
    meta('rodadas com >= 1 Linha', sum((r) => r.roundsWithLinha) / rounds, ...def.linha);
    meta('rodadas com Linha dupla', sum((r) => r.roundsWithDupla) / rounds, ...def.dupla);
    meta('rodadas com oferta de bola extra', sum((r) => r.offersRounds) / rounds, ...def.ofertas);
    meta('bola grátis / ofertas', sum((r) => r.freeOffers) / Math.max(1, sum((r) => r.offers)), ...def.gratis);
    meta('RTP comuns / (apostas + extras pagas)', common / (bets + extra), def.rtp[0], def.rtp[1], false);
    const rec = runs.map((r) => r.recargas);
    const recMean = rec.reduce((a, b) => a + b, 0) / rec.length;
    recMax = Math.max(recMax, recMean);
    const recOk = rpd < 120 || recMean <= 20;
    if (!recOk) metaFalhas++;
    console.log(`  [${recOk ? 'OK ' : 'FORA'}] recargas de presente em ${DAYS} dias: média ${f(recMean, 1)}, máx ${Math.max(...rec)}${rpd >= 120 ? ' (meta <= ~20)' : ''}`);

    console.log(`  RTP comuns / apostas (sem somar extras): ${f(common / bets, 3)} | RTP total (comuns + bingo + acumulado) / (apostas + extras): ${f((common + bingo) / (bets + extra), 3)}`);
    console.log(`  extras: ${f(sum((r) => r.offers) / rounds, 2)} ofertas/rodada; custo pago médio ${f(extra / rounds, 2)} por rodada (+ ${f(sum((r) => r.extraPaidBingo) / runs.length, 0)} por seed em rodadas de bingo) (apostas ${BET * NCARDS}); grátis ${sum((r) => r.freeOffers)} de ${sum((r) => r.offers)}`);
    console.log(`  acumulado pago por seed: ${f(sum((r) => r.jackpotsPaid) / runs.length)} vezes, média ${f(sum((r) => r.jackpotSum) / Math.max(1, sum((r) => r.jackpotsPaid)), 0)} créditos (parcela da aposta ${BET}: ${jackpotShare(BET) * 100}%)`);
    const pc = names.map((p) => `${p} ${pct(sum((r) => r.perCard[p] ?? 0) / (rounds * NCARDS), 2)}`).join(' | ');
    console.log(`  frequência por cartela: ${pc}`);
    const pr = names.map((p) => `${p} ${pct(sum((r) => r.perRoundBest[p] ?? 0) / rounds, 2)}`).join(' | ');
    console.log(`  melhor padrão da rodada: ${pr}`);
    const wk = (i: number) => f(runs.reduce((a, r) => a + (r.weekly[i] ?? 0), 0) / runs.length, 0);
    const weeks = [0, 2, 4, 8, runs[0].weekly.length - 1].filter((v, i, a) => a.indexOf(v) === i && v < runs[0].weekly.length);
    console.log(`  saldo médio ao fim das semanas ${weeks.map((w) => w + 1).join(', ')}: ${weeks.map(wk).join(' | ')}`);
    console.log(`  saldo final médio ${f(sum((r) => r.finalCredits) / runs.length, 0)} (mín visto ${f(Math.min(...runs.map((r) => r.minCredits)), 0)}); recargas por seed: média ${f(recMean, 1)}, máx ${Math.max(...rec)}\n`);
  }

  const rounds = all.reduce((a, r) => a + r.rounds, 0);
  const A = (fn: (r: Run) => number) => all.reduce((a, r) => a + fn(r), 0);
  const fails = violations + metaFalhas;
  console.log(`>> ${name}: ${fails === 0 ? 'OK' : `FORA (${violations} violação(ões) de bingo, ${metaFalhas} meta(s))`}\n`);
  return {
    name, fails,
    share: Math.min(...sh), mean: means.reduce((a, b) => a + b, 0) / means.length, gapMin,
    rtp: A((r) => r.common) / (A((r) => r.bets) + A((r) => r.extraPaid)),
    noPrize: A((r) => r.noPrize) / rounds, linha: A((r) => r.roundsWithLinha) / rounds, dupla: A((r) => r.roundsWithDupla) / rounds,
    ofertas: A((r) => r.offersRounds) / rounds, gratis: A((r) => r.freeOffers) / Math.max(1, A((r) => r.offers)), recargas: recMax,
  };
}

const presetArg = argStr('preset', 'padrao');
const chosen = presetArg === 'all' ? Object.keys(PRESETS) : [presetArg];
for (const n of chosen) {
  if (!PRESETS[n]) { console.log(`Preset desconhecido '${n}'. Opções: ${Object.keys(PRESETS).join(', ')}, all`); process.exit(1); }
}
const summaries = chosen.map(runPreset);

if (chosen.length > 1) {
  console.log('=== TABELA (3 perfis agrupados; bingo% = pior perfil, meses completos na faixa) ===');
  console.log('preset          | bingo% | bingos/mês | gap mín | RTP   | s/prêmio | Linha | Dupla | oferta | grátis | recargas | status');
  for (const x of summaries) {
    console.log(
      `${x.name.padEnd(15)} | ${pct(x.share, 0).padStart(6)} | ${f(x.mean).padStart(10)} | ${f(x.gapMin, 1).padStart(7)} | ${f(x.rtp, 3)} | ${pct(x.noPrize).padStart(8)} | ${pct(x.linha).padStart(5)} | ${pct(x.dupla).padStart(5)} | ${pct(x.ofertas).padStart(6)} | ${pct(x.gratis).padStart(6)} | ${f(x.recargas, 1).padStart(8)} | ${x.fails === 0 ? 'OK' : 'FORA'}`,
    );
  }
  console.log('');
}

// Acumulado parcial: apostas 1 e 2 (perfil 40/dia), com o preset padrão
if (!argStr('nopartial', '') && chosen.length === 1) {
  TUN = PRESETS[chosen[0]].tuning;
  CFG = resolveTuning(TUN);
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

const failed = summaries.filter((x) => x.fails > 0);
console.log(failed.length === 0 ? 'OK: todas as metas atendidas.' : `ATENÇÃO: presets fora das metas: ${failed.map((x) => x.name).join(', ')}.`);
