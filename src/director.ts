import type { Card, DirectorState, DrawPlan, PatternId, RuntimeTuning } from './types';
import {
  TUNING, BINGO_PRESETS, COST_FACTOR, DEFAULT_TUNING, EXTRA_PRESETS, GRATIS_PRESETS, PREMIOS_PRESETS, RTP_COMP, getPatternSet,
} from './config';
import type { PatternSetName, PesosTeto } from './config';
import type { Rng } from './rng';
import { randInt, weightedIndex } from './rng';
import type { DrawTarget, ExtraMode } from './drawBuilder';
import { buildPlanDetailed, tiersBelowBingo } from './drawBuilder';

export const DAY_MS = 86_400_000;

/** Ajustes finos da calibração (o resto vem de TUNING em config.ts). */
export const DIRECTOR_PARAMS = {
  /** Se o histórico ainda não permite estimar o ritmo de jogo, assume N rodadas/dia. */
  rodadasDiaPadrao: 40,
  /** Chance DIÁRIA de bingo (convertida em chance por rodada conforme o ritmo estimado). */
  hazardMin: 0.05, // em diasMin
  hazardAlvo: 0.16, // em diasAlvo
  hazardForcar: 0.55, // em diasForcar
  /** Rodadas (após diasForcar) em que o bingo passa a ser certo. */
  rodadasParaForcar: 20,
  /** Meses com menos de 2 bingos: reforço quando faltam poucos dias no mês. */
  pressaoMes: true,
  /**
   * Pesos do teto da rodada comum, por conjunto de padrões ativo. `nada` = rodada sem prêmio.
   * Padrões ausentes pesam 0. Valores calibrados com `npm run simulate`.
   */
  pesos: {
    classico: { nada: 0.6, linha: 0.35, linhaDupla: 0.06 },
    variado: { nada: 0.6, linha: 0.19, cantos: 0.1, piramide: 0.05, u: 0.03, linhaDupla: 0.015, moldura: 0.015 },
  } as Record<PatternSetName, Partial<Record<PatternId | 'nada', number>>>,
  /** Chance de a rodada comum ser um quase-bingo (oferta cara que não completa). Substitui TUNING.taxaQuaseBingo. */
  taxaQuaseBingo: 0.003,
  /** Fração das ofertas de bola extra que são GRÁTIS (plan.free). Meta: 15-20%. */
  chanceGratis: 0.175,
  /** Chance de outra cartela ativa também ganhar algo na rodada. */
  chanceOutraCartela: 0.1,
  /** Rodada sem prêmio: chance de oferta de bola extra que não completa. */
  missSemPremio: 0.22,
  /** Rodada com prêmio: chance de o padrão sair na bola extra / de oferta que não completa. */
  hitComPremio: 0.25,
  missComPremio: 0.1,
};

// ---------------------------------------------------------------------------
// Configuração resolvida (injetada; sem estado global)
// ---------------------------------------------------------------------------

export interface ResolvedTuning {
  bingoPorMesAlvo: number;
  bingoMaxPorMes: number;
  diasMinEntreBingos: number;
  diasAlvoEntreBingos: number;
  diasForcarBingo: number;
  chanceBingoNaExtra: number;
  /** Pesos do teto da rodada comum por conjunto de padrões. */
  pesos: Record<PatternSetName, PesosTeto>;
  taxaQuaseBingo: number;
  /** Chance de uma oferta de bola extra ser grátis. */
  chanceGratis: number;
  missSemPremio: number;
  hitComPremio: number;
  missComPremio: number;
  /** Fator do custo da bola extra (para o 7º parâmetro de RoundSession). */
  costFactor: number;
}

function compensar(p: Record<PatternSetName, PesosTeto>, f: number): Record<PatternSetName, PesosTeto> {
  if (f === 1) return p;
  const out = {} as Record<PatternSetName, PesosTeto>;
  for (const k of Object.keys(p) as PatternSetName[]) {
    const w: PesosTeto = {};
    let premios = 0;
    for (const [id, v] of Object.entries(p[k]) as [PatternId | 'nada', number][]) {
      if (id === 'nada') continue;
      w[id] = v * f;
      premios += v;
    }
    w.nada = (p[k].nada ?? 0) + premios * (1 - f);
    out[k] = w;
  }
  return out;
}

/** Traduz os presets do painel em números. Pura: o mesmo RuntimeTuning dá sempre o mesmo resultado. */
export function resolveTuning(t: RuntimeTuning): ResolvedTuning {
  const P = DIRECTOR_PARAMS;
  const k = EXTRA_PRESETS[t.ofertaExtra] ?? 1;
  const b = BINGO_PRESETS[t.bingosPorMes] ?? BINGO_PRESETS['2-3'];
  return {
    ...b,
    chanceBingoNaExtra: TUNING.chanceBingoNaExtra,
    pesos: compensar(PREMIOS_PRESETS[t.premiosDoDia] ?? PREMIOS_PRESETS.normal, (RTP_COMP.ofertaExtra[t.ofertaExtra] ?? 1) * (RTP_COMP.chanceGratis[t.chanceGratis] ?? 1) * (RTP_COMP.custoExtra[t.custoExtra] ?? 1)),
    taxaQuaseBingo: P.taxaQuaseBingo,
    chanceGratis: GRATIS_PRESETS[t.chanceGratis] ?? P.chanceGratis,
    missSemPremio: Math.min(0.9, P.missSemPremio * k),
    hitComPremio: Math.min(0.9, P.hitComPremio * k),
    missComPremio: Math.min(0.9, P.missComPremio * k),
    costFactor: COST_FACTOR[t.custoExtra] ?? COST_FACTOR.normal,
  };
}

const DEFAULT_RESOLVED: ResolvedTuning = resolveTuning(DEFAULT_TUNING);

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export function initialDirector(now: number): DirectorState {
  return {
    ultimoBingoEm: null,
    bingosPorMes: {},
    rodadasDesdeUltimoBingo: 0,
    primeiroUsoEm: now,
    historicoBingos: [],
  };
}

/** Chave de mês-calendário local: "2026-10". */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function afterRound(director: DirectorState, now: number, hadBingo: boolean): DirectorState {
  if (!hadBingo) {
    return { ...director, rodadasDesdeUltimoBingo: director.rodadasDesdeUltimoBingo + 1 };
  }
  const key = monthKey(now);
  return {
    ...director,
    ultimoBingoEm: now,
    bingosPorMes: { ...director.bingosPorMes, [key]: (director.bingosPorMes[key] ?? 0) + 1 },
    rodadasDesdeUltimoBingo: 0,
    historicoBingos: [...director.historicoBingos, now],
  };
}

/** Dias desde o último bingo (no primeiro uso, finge que foi há 5 dias). */
export function diasDesdeUltimoBingo(director: DirectorState, now: number): number {
  const ref = director.ultimoBingoEm ?? director.primeiroUsoEm - 5 * DAY_MS;
  return Math.max(0, (now - ref) / DAY_MS);
}

function diasRestantesNoMes(now: number): number {
  const d = new Date(now);
  const fim = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return (fim - now) / DAY_MS;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** Estimativa de rodadas por dia desde o último bingo (ou desde o primeiro uso). */
export function estimarRitmo(director: DirectorState, now: number): number {
  const ini = director.ultimoBingoEm ?? director.primeiroUsoEm;
  const dias = Math.max(1, (now - ini) / DAY_MS);
  if (director.rodadasDesdeUltimoBingo < 5) return DIRECTOR_PARAMS.rodadasDiaPadrao;
  return Math.max(0.2, director.rodadasDesdeUltimoBingo / dias);
}

/** Chance de bingo NA PRÓXIMA rodada (0 se proibido). Exportada para testes/simulador. */
export function bingoChance(director: DirectorState, now: number, T: ResolvedTuning = DEFAULT_RESOLVED): number {
  const P = DIRECTOR_PARAMS;
  const noMes = director.bingosPorMes[monthKey(now)] ?? 0;
  if (noMes >= T.bingoMaxPorMes) return 0;
  const d = diasDesdeUltimoBingo(director, now);
  if (d < T.diasMinEntreBingos) return 0;

  const ritmo = estimarRitmo(director, now);
  let hazard: number;
  if (d <= T.diasAlvoEntreBingos) {
    hazard = lerp(P.hazardMin, P.hazardAlvo, (d - T.diasMinEntreBingos) / (T.diasAlvoEntreBingos - T.diasMinEntreBingos));
  } else {
    hazard = lerp(P.hazardAlvo, P.hazardForcar, (d - T.diasAlvoEntreBingos) / (T.diasForcarBingo - T.diasAlvoEntreBingos));
  }
  // Reforço para meses com poucos bingos (mês corrente pode ser parcial; só atua perto do fim).
  if (P.pressaoMes) {
    const restam = diasRestantesNoMes(now);
    if (noMes === 0 && restam < 14) hazard = Math.max(hazard, lerp(0.3, 0.9, (14 - restam) / 14));
    else if (noMes === 1 && restam < 8) hazard = Math.max(hazard, lerp(0.2, 0.7, (8 - restam) / 8));
  }
  let p = 1 - Math.pow(1 - Math.min(0.995, hazard), 1 / ritmo);
  if (d >= T.diasForcarBingo) {
    const rodadasApos = (d - T.diasForcarBingo) * ritmo;
    p = Math.max(p, Math.min(1, 0.05 + rodadasApos / P.rodadasParaForcar));
  }
  return Math.min(1, Math.max(0, p));
}

// ---------------------------------------------------------------------------
// Escolha do alvo da rodada
// ---------------------------------------------------------------------------

/** Tetos possíveis de uma rodada comum no conjunto ativo: [null, ...padrões abaixo do bingo]. */
function tiers(): (PatternId | null)[] {
  return [null, ...tiersBelowBingo()];
}

function tierWeights(T: ResolvedTuning): number[] {
  const w = T.pesos[getPatternSet()] ?? {};
  const t = tiers();
  return t.map((p) => (p === null ? w.nada ?? 0.6 : w[p] ?? 0));
}

/** Sorteia quais ofertas de bola extra são grátis (uma flag por bola extra do plano). */
export function rollFree(count: number, rng: Rng, chance: number = DEFAULT_RESOLVED.chanceGratis): boolean[] {
  return Array.from({ length: count }, () => rng() < chance);
}

function activeIdx(active: boolean[]): number[] {
  const out: number[] = [];
  active.forEach((a, i) => {
    if (a) out.push(i);
  });
  return out.length ? out : [0];
}

/** Sorteia caps das cartelas que não são a protagonista. */
function otherCaps(
  caps: (PatternId | null)[],
  focus: number,
  idx: number[],
  maxLevel: number,
  chance: number,
  rng: Rng,
  T: ResolvedTuning,
): void {
  const w = tierWeights(T);
  const t = tiers();
  for (const j of idx) {
    if (j === focus || rng() >= chance) continue;
    const ws = w.map((x, k) => (k === 0 || k > maxLevel ? 0 : x));
    if (ws.every((x) => x === 0)) continue;
    caps[j] = t[weightedIndex(ws, rng)];
  }
}

/** Nas rodadas de bingo/quase-bingo as demais cartelas ganham no máximo o nível 1 (linha) ou 2 (cantos, no variado). */
const small = () => (getPatternSet() === 'classico' ? 1 : 2);

export function sampleTarget(
  active: boolean[],
  wantBingo: boolean,
  rng: Rng,
  T: ResolvedTuning = DEFAULT_RESOLVED,
): DrawTarget {
  const P = DIRECTOR_PARAMS;
  const idx = activeIdx(active);
  const n = active.length;
  const caps: (PatternId | null)[] = new Array(n).fill(null);
  const focus = idx[randInt(idx.length, rng)];

  if (wantBingo) {
    caps[focus] = 'bingo';
    // nas rodadas de bingo, as demais cartelas ganham no máximo algo bem pequeno
    otherCaps(caps, focus, idx, small(), 0.15, rng, T);
    return {
      maxPattern: caps,
      bingo: { at: rng() < T.chanceBingoNaExtra ? 'extra' : 'main' },
      focus,
    };
  }
  if (rng() < T.taxaQuaseBingo) {
    otherCaps(caps, focus, idx, small(), 0.15, rng, T);
    return { maxPattern: caps, almost: true, focus };
  }

  const t = tiers();
  const tier = weightedIndex(tierWeights(T), rng);
  caps[focus] = t[tier];
  otherCaps(caps, focus, idx, tier, P.chanceOutraCartela, rng, T);
  let extra: ExtraMode;
  const r = rng();
  if (tier === 0) extra = r < T.missSemPremio ? 'miss' : 'none';
  else if (r < T.hitComPremio) extra = 'hit';
  else if (r < T.hitComPremio + T.missComPremio && tier < t.length - 1) extra = 'miss'; // 'miss' em padrão alto vira quase-bingo caro
  else extra = 'none';
  return { maxPattern: caps, extra, focus };
}

export interface PlanRoundInput {
  cards: Card[];
  active: boolean[];
  bet: number;
  now: number;
  director: DirectorState;
  rng: Rng;
  /** Ajustes do painel (padrão: DEFAULT_TUNING). Vale só para esta rodada. */
  tuning?: RuntimeTuning;
}

export function planRound(input: PlanRoundInput): { plan: DrawPlan; intendedBingo: boolean } {
  const { cards, active, now, director, rng } = input;
  const T = input.tuning ? resolveTuning(input.tuning) : DEFAULT_RESOLVED;
  const wantBingo = rng() < bingoChance(director, now, T);
  const target = sampleTarget(active, wantBingo, rng, T);
  const built = buildPlanDetailed(cards, active, target, rng);
  const plan: DrawPlan = { ...built.plan, free: rollFree(built.plan.extras.length, rng, T.chanceGratis) };
  return { plan, intendedBingo: !!built.target.bingo && built.validated };
}
