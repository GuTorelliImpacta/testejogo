import type { Card, CardResult, DrawPlan, PatternId, RoundSummary, SavedRound } from './types';
import { BALLS_EXTRA_MAX, BALLS_MAIN } from './types';
import { bestPattern, levelOf, missing } from './patterns';
import { markedMask } from './cards';
import { extraInfo, prizeFor, jackpotShare } from './payout';
import { activePatterns } from './config';

export interface ExtraOffer {
  cost: number; // 0 quando free
  free: boolean;
  remaining: number; // extras ainda disponíveis (incluindo esta)
  improves: { cardIndex: number; pattern: PatternId; gain: number }[];
}

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
  freeExtras = 0;
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
    extraSpent = 0,
    readonly costFactor = 0.08,
  ) {
    this.best = cards.map(() => null);
    this.extraSpent = extraSpent;
  }

  /** Define o gasto com extras já feito (rodada restaurada do save). */
  restore(extraSpent: number): this {
    this.extraSpent = extraSpent;
    return this;
  }

  /** Reconstrói a sessão de uma rodada salva repetindo as bolas já sorteadas (sem cobrar de novo). */
  static fromSaved(sr: SavedRound, costFactor = 0.08): RoundSession {
    const s = new RoundSession(sr.cards, sr.active, sr.bet, sr.jackpot, sr.plan, 0, costFactor);
    for (let i = 0; i < sr.mainIdx; i++) s.nextMain();
    for (let i = 0; i < sr.extrasUsed; i++) {
      s.apply(sr.plan.extras[i], s.extrasUsed++, true);
      if (sr.plan.free?.[i] === true) s.freeExtras++;
    }
    s.extraSpent = sr.extraSpent ?? 0;
    return s;
  }

  /** Parcela do acumulado paga nesta aposta (1, 0.75 ou 0.5). */
  get jackpotShare(): number {
    return jackpotShare(this.bet);
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

  /**
   * Oferta de bola extra, ou null se não há (sem "falta 1", extras esgotadas).
   * free = plan.free?.[extrasUsed] === true -> cost 0 e nada é debitado.
   */
  offer(): ExtraOffer | null {
    const max = Math.min(BALLS_EXTRA_MAX, this.plan.extras.length);
    if (this.extrasUsed >= max) return null;
    const info = extraInfo(this.cards, this.active, this.drawn, this.bet, this.costFactor);
    if (info.cost <= 0) return null;
    const free = this.plan.free?.[this.extrasUsed] === true;
    return { cost: free ? 0 : info.cost, free, remaining: max - this.extrasUsed, improves: info.improves };
  }

  /**
   * Custo PAGO da próxima extra. Devolve 0 se não há oferta OU se a oferta é grátis
   * (nesse caso offer() é não-nulo). Para saber se há oferta use offer().
   */
  offerCost(): number {
    return this.offer()?.cost ?? 0;
  }

  /** Compra (ou aceita, se grátis) a oferta atual. Soma extraSpent só se paga. */
  buyExtra(): { step: Step; cost: number; free: boolean } | null {
    const o = this.offer();
    if (!o) return null;
    this.extraSpent += o.cost;
    if (o.free) this.freeExtras++;
    const ball = this.plan.extras[this.extrasUsed];
    const step = this.apply(ball, this.extrasUsed++, true);
    return { step, cost: o.cost, free: o.free };
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
            this.jackpotAmount = Math.floor(this.jackpot * this.jackpotShare);
            this.bingoMainBall = true;
          }
        }
      }
      // "Falta uma" para padrão >= linha dupla (primeira vez na rodada por cartela/padrão)
      const act = activePatterns();
      for (const p of ['bingo', 'moldura', 'linhaDupla'] as PatternId[]) {
        if (!act.includes(p)) continue;
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
      freeExtras: this.freeExtras,
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
  while (s.offer()) {
    offered = true;
    if (!buyExtras) break;
    const r = s.buyExtra();
    if (!r) break;
    if (r.step.bingo) bingoOnExtra = true;
  }
  return { summary: s.finish(), offered, bingoOnExtra };
}
