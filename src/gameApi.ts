import type { Card, GamePhase, RoundSummary, Settings } from './types';

/** Fotografia somente-leitura do jogo para a UI desenhar. */
export interface GameView {
  phase: GamePhase;
  credits: number;
  bet: number;
  totalBet: number;
  jackpot: number;
  cards: Card[];
  active: boolean[];
  drawn: number[]; // bolas já sorteadas, na ordem
  current: number | null; // última bola
  mainCount: number; // quantas das 30 principais já saíram
  extraOffer: { cost: number; remaining: number } | null;
  summary: RoundSummary | null; // preenchido em celebrating/idle após rodada
  auto: boolean;
  settings: Settings;
  giftAmount: number; // >0 na fase 'gift'
}

/** Ações que a UI pode pedir ao jogo (implementadas pelo orquestrador em game.ts). */
export interface GameApi {
  getView(): GameView;
  enter(): void; // toque em ENTRAR (libera áudio)
  play(): void;
  accelerate(): void;
  buyExtra(): void;
  finishExtra(): void;
  continueCelebration(): void;
  takeGift(): void;
  toggleCard(i: number): void;
  changeBet(dir: 1 | -1): void;
  swapCards(): void;
  setAuto(on: boolean): void;
  updateSettings(p: Partial<Settings>): void;
  /** Painel admin */
  admin: {
    unlock(pin: string): boolean;
    snapshot(): unknown;
    exportJson(): string;
    importJson(s: string): boolean;
    resetJackpot(): void;
    resetCredits(): void;
  };
}
