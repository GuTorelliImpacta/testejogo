import type { Card, DirectorState, DrawPlan, PatternId } from './types';
import { PATTERN_ORDER } from './types';
import { TUNING } from './config';
import type { Rng } from './rng';
import { randInt, weightedIndex } from './rng';
import type { DrawTarget, ExtraMode } from './drawBuilder';
import { buildPlanDetailed } from './drawBuilder';

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
  /** Pesos do nível máximo da rodada comum: nada, linha, cantos, pirâmide, U, linha dupla, moldura. */
  pesosNivel: [0.61, 0.167, 0.11, 0.052, 0.033, 0.012, 0.015],
  /** Chance de outra cartela ativa também ganhar algo na rodada. */
  chanceOutraCartela: 0.3,
  /** Rodada sem prêmio: chance de oferta de bola extra que não completa. */
  missSemPremio: 0.22,
  /** Rodada com prêmio: chance de o padrão sair na bola extra / de oferta que não completa. */
  hitComPremio: 0.25,
  missComPremio: 0.1,
};

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
export function bingoChance(director: DirectorState, now: number): number {
  const P = DIRECTOR_PARAMS;
  const noMes = director.bingosPorMes[monthKey(now)] ?? 0;
  if (noMes >= TUNING.bingoMaxPorMes) return 0;
  const d = diasDesdeUltimoBingo(director, now);
  if (d < TUNING.diasMinEntreBingos) return 0;

  const ritmo = estimarRitmo(director, now);
  let hazard: number;
  if (d <= TUNING.diasAlvoEntreBingos) {
    hazard = lerp(P.hazardMin, P.hazardAlvo, (d - TUNING.diasMinEntreBingos) / (TUNING.diasAlvoEntreBingos - TUNING.diasMinEntreBingos));
  } else {
    hazard = lerp(P.hazardAlvo, P.hazardForcar, (d - TUNING.diasAlvoEntreBingos) / (TUNING.diasForcarBingo - TUNING.diasAlvoEntreBingos));
  }
  // Reforço para meses com poucos bingos (mês corrente pode ser parcial; só atua perto do fim).
  if (P.pressaoMes) {
    const restam = diasRestantesNoMes(now);
    if (noMes === 0 && restam < 14) hazard = Math.max(hazard, lerp(0.3, 0.9, (14 - restam) / 14));
    else if (noMes === 1 && restam < 8) hazard = Math.max(hazard, lerp(0.2, 0.7, (8 - restam) / 8));
  }
  let p = 1 - Math.pow(1 - Math.min(0.995, hazard), 1 / ritmo);
  if (d >= TUNING.diasForcarBingo) {
    const rodadasApos = (d - TUNING.diasForcarBingo) * ritmo;
    p = Math.max(p, Math.min(1, 0.05 + rodadasApos / P.rodadasParaForcar));
  }
  return Math.min(1, Math.max(0, p));
}

// ---------------------------------------------------------------------------
// Escolha do alvo da rodada
// ---------------------------------------------------------------------------

const TIERS: (PatternId | null)[] = [null, ...PATTERN_ORDER.filter((p) => p !== 'bingo')];

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
): void {
  const w = DIRECTOR_PARAMS.pesosNivel;
  for (const j of idx) {
    if (j === focus || rng() >= chance) continue;
    const ws = w.map((x, k) => (k === 0 || k > maxLevel ? 0 : x));
    if (ws.every((x) => x === 0)) continue;
    caps[j] = TIERS[weightedIndex(ws, rng)];
  }
}

export function sampleTarget(
  active: boolean[],
  wantBingo: boolean,
  rng: Rng,
): DrawTarget {
  const P = DIRECTOR_PARAMS;
  const idx = activeIdx(active);
  const n = active.length;
  const caps: (PatternId | null)[] = new Array(n).fill(null);
  const focus = idx[randInt(idx.length, rng)];

  if (wantBingo) {
    caps[focus] = 'bingo';
    // nas rodadas de bingo, as demais cartelas ganham no máximo algo bem pequeno
    otherCaps(caps, focus, idx, 2, 0.15, rng);
    return {
      maxPattern: caps,
      bingo: { at: rng() < TUNING.chanceBingoNaExtra ? 'extra' : 'main' },
      focus,
    };
  }
  if (rng() < TUNING.taxaQuaseBingo) {
    otherCaps(caps, focus, idx, 2, 0.15, rng);
    return { maxPattern: caps, almost: true, focus };
  }

  const tier = weightedIndex(P.pesosNivel, rng);
  caps[focus] = TIERS[tier];
  otherCaps(caps, focus, idx, tier, P.chanceOutraCartela, rng);
  let extra: ExtraMode;
  const r = rng();
  if (tier === 0) extra = r < P.missSemPremio ? 'miss' : 'none';
  else if (r < P.hitComPremio) extra = 'hit';
  else if (r < P.hitComPremio + P.missComPremio && tier <= 4) extra = 'miss'; // 'miss' em padrão alto vira quase-bingo caro
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
}

export function planRound(input: PlanRoundInput): { plan: DrawPlan; intendedBingo: boolean } {
  const { cards, active, now, director, rng } = input;
  const wantBingo = rng() < bingoChance(director, now);
  const target = sampleTarget(active, wantBingo, rng);
  const built = buildPlanDetailed(cards, active, target, rng);
  return { plan: built.plan, intendedBingo: !!built.target.bingo && built.validated };
}
