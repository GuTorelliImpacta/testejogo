import type { Card, GamePhase, PatternId, RoundSummary, Settings } from './types';

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
  extraOffer: { cost: number; free: boolean; remaining: number; improves: { cardIndex: number; pattern: PatternId; gain: number }[] } | null;
  extraTotal: number; // 9
  extrasDrawn: number; // quantas extras já saíram nesta rodada
  turbo: boolean;
  cardCount: number; // 1..4 (as primeiras N cartelas ficam ativas)
  /** Valores em créditos para a aposta atual, só dos padrões do conjunto ativo. */
  prizeTable: { pattern: PatternId; prize: number }[];
  jackpotShare: number; // 1, 0.75 ou 0.5
  /** Carta do correio esperando (ícone no topo) e se a tela dela está aberta. */
  mail: { kind: 'daily' | 'bonus'; amount: number; open: boolean } | null;
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
  buyExtra(): void;
  finishExtra(): void;
  continueCelebration(): void;
  takeGift(): void;
  changeBet(dir: 1 | -1): void;
  /** Quantidade de cartelas (1..4); as primeiras N ficam ativas. */
  changeCards(dir: 1 | -1): void;
  /** Botão "Números": sorteia cartelas novas (só entre rodadas). */
  shuffleCards(): void;
  setTurbo(on: boolean): void;
  openMail(): void; // toca no ícone do correio
  claimMail(): void; // PEGAR
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
    setPatternSet(name: 'classico' | 'variado'): void;
  };
}
