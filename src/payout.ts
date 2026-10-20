import type { Card, PatternId } from './types';
import { MULTIPLIER, JACKPOT_BASE, JACKPOT_GROWTH } from './config';
import { bestPattern, bestReachableByOne } from './patterns';
import { markedMask } from './cards';

export function prizeFor(pattern: PatternId | null, bet: number): number {
  return pattern ? bet * MULTIPLIER[pattern] : 0;
}

export function nextJackpot(current: number, totalBet: number): number {
  return Math.round(current + totalBet * JACKPOT_GROWTH);
}

export { JACKPOT_BASE };

const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export function niceRound(v: number): number {
  let best = NICE[0];
  for (const n of NICE) if (Math.abs(n - v) <= Math.abs(best - v)) best = n;
  return best;
}

/**
 * Custo da bola extra: max(1, round(0,08 × maior prêmio adicional possível)),
 * arredondado para valor "redondo". Retorna 0 se não há chance de melhora.
 */
export function extraCost(
  cards: Card[],
  active: boolean[],
  drawn: ReadonlySet<number>,
  bet: number,
): number {
  let maxGain = 0;
  cards.forEach((card, i) => {
    if (!active[i]) return;
    const marked = markedMask(card, drawn);
    const cur = bestPattern(marked);
    const next = bestReachableByOne(marked);
    if (!next) return;
    const gain = prizeFor(next, bet) - prizeFor(cur, bet);
    if (gain > maxGain) maxGain = gain;
  });
  if (maxGain <= 0) return 0;
  return niceRound(Math.max(1, Math.round(0.08 * maxGain)));
}
