import type { PatternId, Settings } from './types';

export const GAME_NAME = 'Altina da Sorte🍀';
export const PLAYER = 'Dona Altina';

export const ADMIN_PIN = '1958';

export const START_CREDITS = 1000;
export const GIFT_AMOUNT = 1000;
export const DAILY_BONUS = 300;
export const GIFT_THRESHOLD = 50;
export const JACKPOT_BASE = 5000;
export const JACKPOT_GROWTH = 0.02;
export const BET_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const DEFAULT_BET = 5;
export const DEFAULT_CARDS = 4;

/** Turbo: as 30 bolas saem de uma vez; pausa (ms) depois do preenchimento, antes da oferta de extra/resultado. */
export const TURBO_MS = 500;

export const SPEED_MS = { lenta: 2000, normal: 1400, rapida: 900 } as const;

/** Multiplicadores sobre a aposta da cartela. Os padrões fora do conjunto ativo nunca pagam. */
export const MULTIPLIER: Record<PatternId, number> = {
  linha: 5,
  cantos: 3,
  piramide: 8,
  u: 12,
  linhaDupla: 25,
  moldura: 40,
  bingo: 500,
};

/** Conjuntos de padrões. Troca só pelo painel do administrador (`setPatternSet`). */
export const PATTERN_SETS: Record<'classico' | 'variado', PatternId[]> = {
  classico: ['linha', 'linhaDupla', 'bingo'],
  variado: ['linha', 'cantos', 'piramide', 'u', 'linhaDupla', 'moldura', 'bingo'],
};
export type PatternSetName = keyof typeof PATTERN_SETS;
export const DEFAULT_PATTERN_SET: PatternSetName = 'classico';

/** Parte do acumulado paga conforme a aposta por cartela (Bingo até a 30ª bola). */
export function jackpotShare(bet: number): number {
  return bet >= 3 ? 1 : bet === 2 ? 0.75 : 0.5;
}

/** Faixas de cor das bolas (18 números por faixa). */
export const BALL_BAND = 18;

/** Correio da sorte (bônus). */
export const MAIL = {
  dailyAmount: DAILY_BONUS,
  bonusMin: 10,
  bonusMax: 100,
  bonusMaxPerDay: 2,
  minPlayMsBeforeBonus: 30 * 60 * 1000,
};

export const TUNING = {
  bingoPorMesAlvo: 2.5,
  bingoMaxPorMes: 3,
  diasMinEntreBingos: 7,
  diasAlvoEntreBingos: 12,
  diasForcarBingo: 16,
  rtpAlvo: 0.88,
  chanceBingoNaExtra: 0.6,
  taxaQuaseBingo: 0.04,
};

export const DEFAULT_SETTINGS: Settings = {
  speed: 'normal',
  turbo: false,
  bordoes: true,
  lightManual: false,
  volMusic: 0.4,
  volVoice: 1,
  volSfx: 0.7,
  muted: false,
  captions: true,
  light: false,
  textSize: 'normal',
};

let patternSetName: PatternSetName = DEFAULT_PATTERN_SET;
/** Padrões que pagam hoje (ordem crescente de valor). Lido por patterns.ts/payout.ts. */
export function activePatterns(): PatternId[] {
  return PATTERN_SETS[patternSetName];
}
export function getPatternSet(): PatternSetName {
  return patternSetName;
}
export function setPatternSet(name: PatternSetName): void {
  patternSetName = name;
}
