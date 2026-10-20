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
export const BET_OPTIONS = [1, 2, 5, 10, 20];

export const SPEED_MS = { lenta: 2000, normal: 1400, rapida: 900 } as const;

export const MULTIPLIER: Record<PatternId, number> = {
  linha: 2,
  cantos: 3,
  piramide: 8,
  u: 12,
  linhaDupla: 15,
  moldura: 40,
  bingo: 300,
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
  volMusic: 0.4,
  volVoice: 1,
  volSfx: 0.7,
  muted: false,
  captions: true,
  light: false,
  textSize: 'normal',
};
