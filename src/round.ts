import type { Card, CardResult, DrawPlan, PatternId, RoundSummary } from './types';
import { BALLS_EXTRA_MAX, BALLS_MAIN } from './types';
import { bestPattern, levelOf, missing } from './patterns';
import { markedMask } from './cards';
import { extraCost, prizeFor } from './payout';

export interface Step {
  ball: number;
  index: number; // 0-based dentro da lista (main ou extras)
  extra: boolean;
  won: { cardIndex: number; pattern: PatternId }[]; // padrões novos/melhorados nesta bola
  almost: { cardIndex: number; pattern: PatternId; forBingo: boolean }[];
  bingo: { cardIndex: number } | null; // primeiro bingo (novo) nesta bola
}

/** Sessão de rodada pura (sem timers, sem DOM). Usada pelo jogo e pelo simulador. */
export class RoundSession {
  readonly drawn = new Set<number>();
  mainIdx = 0;
  extrasUsed = 0;
  extraSpent = 0;
  jackpotAmount = 0; // acumulado pago nesta rodada
  private best: (PatternId | null)[];
  private almostSeen = new Set<string>();
  private bingoMainBall = false;

  constructor(
    readonly cards: Card[],
    readonly active: boolean[],
    readonly bet: number,
    readonly jackpot: number,
    readonly plan: DrawPlan,
  ) {
    this.best = cards.map(() => null);
  }

  get totalBet(): number {
    return this.bet * this.active.filter(Boolean).length;
  }

  get mainDone(): boolean {
    return this.mainIdx >= BALLS_MAIN;
  }

  nextMain(): Step | null {
    if (this.mainDone) return null;
    const ball = this.plan.main[this.mainIdx];
    return this.apply(ball, this.mainIdx++, false);
  }

  /** Custo da próxima bola extra, ou 0 se não houver oferta. */
  offerCost(): number {
    if (this.extrasUsed >= Math.min(BALLS_EXTRA_MAX, this.plan.extras.length)) return 0;
    return extraCost(this.cards, this.active, this.drawn, this.bet);
  }

  buyExtra(): { step: Step; cost: number } | null {
    const cost = this.offerCost();
    if (!cost) return null;
    this.extraSpent += cost;
    const ball = this.plan.extras[this.extrasUsed];
    const step = this.apply(ball, this.extrasUsed++, true);
    return { step, cost };
  }

  private apply(ball: number, index: number, extra: boolean): Step {
    this.drawn.add(ball);
    const won: Step['won'] = [];
    const almost: Step['almost'] = [];
    let bingo: Step['bingo'] = null;
    this.cards.forEach((card, i) => {
      if (!this.active[i]) return;
      const marked = markedMask(card, this.drawn);
      const cur = bestPattern(marked);
      if (levelOf(cur) > levelOf(this.best[i])) {
        this.best[i] = cur;
        won.push({ cardIndex: i, pattern: cur! });
        if (cur === 'bingo' && !bingo) {
          bingo = { cardIndex: i };
          if (!extra && this.jackpotAmount === 0) {
            this.jackpotAmount = this.jackpot;
            this.bingoMainBall = true;
          }
        }
      }
      // "Falta uma" para padrão >= linha dupla (primeira vez na rodada por cartela/padrão)
      for (const p of ['bingo', 'moldura', 'linhaDupla'] as PatternId[]) {
        if (levelOf(cur) >= levelOf(p)) break;
        if (missing(marked, p) === 1) {
          const key = `${i}:${p}`;
          if (!this.almostSeen.has(key)) {
            this.almostSeen.add(key);
            almost.push({ cardIndex: i, pattern: p, forBingo: p === 'bingo' });
          }
          break;
        }
      }
    });
    return { ball, index, extra, won, almost, bingo };
  }

  finish(): RoundSummary {
    const results: CardResult[] = this.cards.map((_, i) => ({
      cardIndex: i,
      pattern: this.active[i] ? this.best[i] : null,
      prize: this.active[i] ? prizeFor(this.best[i], this.bet) : 0,
      jackpot: false,
    }));
    if (this.jackpotAmount > 0) {
      const r = results.find((x) => x.pattern === 'bingo');
      if (r) r.jackpot = true;
    }
    const prize = results.reduce((s, r) => s + r.prize, 0) + this.jackpotAmount;
    let top: PatternId | null = null;
    for (const r of results) if (levelOf(r.pattern) > levelOf(top)) top = r.pattern;
    return {
      bet: this.bet,
      totalBet: this.totalBet,
      results,
      prize,
      jackpot: this.jackpotAmount,
      extrasUsed: this.extrasUsed,
      extraCost: this.extraSpent,
      best: top,
    };
  }

  get jackpotHit(): boolean {
    return this.bingoMainBall;
  }
}

/** Joga uma rodada inteira de forma automática (para simulador/testes). */
export function playRound(
  cards: Card[],
  active: boolean[],
  bet: number,
  jackpot: number,
  plan: DrawPlan,
  buyExtras = true,
): { summary: RoundSummary; offered: boolean; bingoOnExtra: boolean } {
  const s = new RoundSession(cards, active, bet, jackpot, plan);
  while (s.nextMain()) {
    /* sorteia as 30 */
  }
  let offered = false;
  let bingoOnExtra = false;
  while (s.offerCost() > 0) {
    offered = true;
    if (!buyExtras) break;
    const r = s.buyExtra();
    if (!r) break;
    if (r.step.bingo) bingoOnExtra = true;
  }
  return { summary: s.finish(), offered, bingoOnExtra };
}
