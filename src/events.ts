import type { PatternId, RoundSummary } from './types';

/** Mapa de eventos do jogo. UI e áudio apenas escutam. */
export interface GameEvents {
  roundStart: { bet: number; totalBet: number };
  /** `index` 0-based; `total` = 30 (principais) ou 9 (extras). */
  ballDrawn: { ball: number; index: number; total: number; extra: boolean; fast: boolean };
  /** Cartela a 1 número de um padrão >= linha dupla (primeira vez na rodada). */
  almost: { cardIndex: number; pattern: PatternId; forBingo: boolean };
  patternWon: { cardIndex: number; pattern: PatternId; prize: number; ball: number };
  extraOffer: { cost: number; free: boolean; remaining: number; improves: { cardIndex: number; pattern: PatternId; gain: number }[] };
  /** A próxima bola extra é grátis (destaque dourado, "Bola extra grátis!"). */
  freeExtra: undefined;
  /** Chegou/foi aberta uma carta do correio da sorte. */
  mailbox: { kind: 'daily' | 'bonus'; amount: number; state: 'arrived' | 'opened' | 'claimed' };
  turboChanged: { on: boolean };
  extraBought: { cost: number; number: number };
  roundEnd: { summary: RoundSummary; won: boolean };
  bingo: { cardIndex: number; viaExtra: boolean };
  jackpot: { amount: number };
  giftCredits: { amount: number };
  dailyBonus: { amount: number };
  /** Estado mudou (para a UI redesenhar saldo, botões, etc.). */
  stateChanged: undefined;
}

type Handler<T> = (payload: T) => void;

export class Bus {
  private map = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(ev: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.map.get(ev);
    if (!set) this.map.set(ev, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(ev: K, payload?: GameEvents[K]): void {
    const set = this.map.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        console.error('handler error', ev, e);
      }
    }
  }
}

export const bus = new Bus();
