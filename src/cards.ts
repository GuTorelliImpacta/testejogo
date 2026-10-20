import type { Card } from './types';
import { CARD_COUNT } from './types';
import type { Rng } from './rng';

/** Coluna c contém 12c+1..12c+12; 3 números por coluna, ordenados de cima para baixo. */
export function generateCard(rng: Rng): Card {
  const nums = new Array<number>(15);
  for (let c = 0; c < 5; c++) {
    const pool = Array.from({ length: 12 }, (_, i) => 12 * c + 1 + i);
    for (let i = 0; i < 3; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const col = pool.slice(0, 3).sort((a, b) => a - b);
    for (let r = 0; r < 3; r++) nums[r * 5 + c] = col[r];
  }
  return { nums };
}

export function generateCards(rng: Rng, n = CARD_COUNT): Card[] {
  return Array.from({ length: n }, () => generateCard(rng));
}

export function isValidCard(card: Card): boolean {
  if (card.nums.length !== 15) return false;
  if (new Set(card.nums).size !== 15) return false;
  for (let c = 0; c < 5; c++) {
    let prev = 0;
    for (let r = 0; r < 3; r++) {
      const n = card.nums[r * 5 + c];
      if (n < 12 * c + 1 || n > 12 * c + 12 || n <= prev) return false;
      prev = n;
    }
  }
  return true;
}

/** Bitmask dos números marcados na cartela dado o conjunto de bolas sorteadas. */
export function markedMask(card: Card, drawn: ReadonlySet<number>): number {
  let m = 0;
  for (let i = 0; i < 15; i++) if (drawn.has(card.nums[i])) m |= 1 << i;
  return m;
}
