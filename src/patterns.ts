import type { Mask, PatternId } from './types';
import { PATTERN_ORDER } from './types';

/** Constrói máscara a partir de 3 strings de 5 caracteres ('X' = exigido). */
function m(rows: [string, string, string]): Mask {
  let mask = 0;
  rows.forEach((row, r) => {
    for (let c = 0; c < 5; c++) if (row[c] === 'X') mask |= 1 << (r * 5 + c);
  });
  return mask;
}

const ROW = [0, 1, 2].map((r) => 0b11111 << (r * 5));

export const MASKS: Record<PatternId, Mask[]> = {
  linha: ROW.slice(),
  cantos: [m(['X...X', '..X..', 'X...X'])],
  piramide: [m(['..X..', '.XXX.', 'XXXXX'])],
  u: [m(['X...X', 'X...X', 'XXXXX'])],
  linhaDupla: [ROW[0] | ROW[1], ROW[0] | ROW[2], ROW[1] | ROW[2]],
  moldura: [m(['XXXXX', 'X...X', 'XXXXX'])],
  bingo: [0x7fff],
};

export function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

export function levelOf(p: PatternId | null): number {
  return p ? PATTERN_ORDER.indexOf(p) + 1 : 0;
}

/** Números que ainda faltam para completar o padrão (melhor máscara). */
export function missing(marked: Mask, pattern: PatternId): number {
  let best = 99;
  for (const mask of MASKS[pattern]) {
    const miss = popcount(mask & ~marked);
    if (miss < best) best = miss;
  }
  return best;
}

export function isComplete(marked: Mask, pattern: PatternId): boolean {
  return missing(marked, pattern) === 0;
}

/** Maior padrão completo, ou null. */
export function bestPattern(marked: Mask): PatternId | null {
  for (let i = PATTERN_ORDER.length - 1; i >= 0; i--) {
    if (isComplete(marked, PATTERN_ORDER[i])) return PATTERN_ORDER[i];
  }
  return null;
}

/** Maior padrão estritamente melhor que o atual a exatamente 1 número de completar. */
export function bestReachableByOne(marked: Mask): PatternId | null {
  const cur = levelOf(bestPattern(marked));
  for (let i = PATTERN_ORDER.length - 1; i >= cur; i--) {
    if (missing(marked, PATTERN_ORDER[i]) === 1) return PATTERN_ORDER[i];
  }
  return null;
}

/** Posições (0..14) que, se marcadas, completariam o padrão (quando falta exatamente 1). */
export function missingCells(marked: Mask, pattern: PatternId): number[] {
  const out = new Set<number>();
  for (const mask of MASKS[pattern]) {
    const rest = mask & ~marked;
    if (popcount(rest) === 1) out.add(31 - Math.clz32(rest));
  }
  return [...out];
}
