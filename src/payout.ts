import type { Card, PatternId } from './types';
import { MULTIPLIER, JACKPOT_BASE, JACKPOT_GROWTH, jackpotShare, activePatterns } from './config';
import { bestPattern, bestReachableByOne } from './patterns';
import { markedMask } from './cards';

export function prizeFor(pattern: PatternId | null, bet: number): number {
  if (!pattern || !activePatterns().includes(pattern)) return 0;
  return bet * MULTIPLIER[pattern];
}

export { jackpotShare };

/** Valor pago do acumulado: floor(acumulado × parcela da aposta). */
export function jackpotPayout(jackpot: number, bet: number): number {
  return Math.floor(jackpot * jackpotShare(bet));
}

/** Prêmios dos padrões ativos para a aposta por cartela (ordem crescente). */
export function prizeTable(bet: number): { pattern: PatternId; prize: number }[] {
  return activePatterns().map((pattern) => ({ pattern, prize: prizeFor(pattern, bet) }));
}

export interface Improve {
  cardIndex: number;
  pattern: PatternId;
  gain: number;
}

/** Por cartela ativa: melhor padrão alcançável com 1 número e o ganho (prêmio novo − atual). */
export function extraImproves(
  cards: Card[],
  active: boolean[],
  drawn: ReadonlySet<number>,
  bet: number,
): Improve[] {
  const out: Improve[] = [];
  cards.forEach((card, i) => {
    if (!active[i]) return;
    const marked = markedMask(card, drawn);
    const next = bestReachableByOne(marked);
    if (!next) return;
    const gain = prizeFor(next, bet) - prizeFor(bestPattern(marked), bet);
    if (gain > 0) out.push({ cardIndex: i, pattern: next, gain });
  });
  return out;
}

/** Custo (ver extraCost) + lista `improves`. cost 0 = sem oferta. */
export function extraInfo(
  cards: Card[],
  active: boolean[],
  drawn: ReadonlySet<number>,
  bet: number,
): { cost: number; improves: Improve[] } {
  const improves = extraImproves(cards, active, drawn, bet);
  const maxGain = improves.reduce((m, x) => Math.max(m, x.gain), 0);
  if (maxGain <= 0) return { cost: 0, improves: [] };
  return { cost: niceRound(Math.max(1, Math.round(0.08 * maxGain))), improves };
}

export function nextJackpot(current: number, totalBet: number): number {
  return current + totalBet * JACKPOT_GROWTH; // fracionário; exibir/pagar com Math.floor
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
  return extraInfo(cards, active, drawn, bet).cost;
}
