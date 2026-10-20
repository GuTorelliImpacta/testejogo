import type { PatternId, RuntimeTuning, Settings } from './types';

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

/** Intervalo entre bolas no Turbo (ms). */
export const TURBO_MS = 120;

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


// ---------- v3: ajustes em tempo de execução ----------
export const DEFAULT_TUNING: RuntimeTuning = {
  bingosPorMes: '2-3',
  premiosDoDia: 'normal',
  ofertaExtra: 'normal',
  chanceGratis: 'normal',
  custoExtra: 'normal',
  presente: 1000,
  correioDiario: 300,
  conjuntoPadroes: 'classico',
};

/** Parâmetros de bingo por opção do painel. Calibrados pelo `odds-director` no simulador. */
export const BINGO_PRESETS: Record<
  RuntimeTuning['bingosPorMes'],
  { bingoPorMesAlvo: number; bingoMaxPorMes: number; diasMinEntreBingos: number; diasAlvoEntreBingos: number; diasForcarBingo: number }
> = {
  '1': { bingoPorMesAlvo: 1, bingoMaxPorMes: 1, diasMinEntreBingos: 14, diasAlvoEntreBingos: 24, diasForcarBingo: 33 },
  '2': { bingoPorMesAlvo: 2, bingoMaxPorMes: 2, diasMinEntreBingos: 9, diasAlvoEntreBingos: 14, diasForcarBingo: 19 },
  '2-3': { bingoPorMesAlvo: TUNING.bingoPorMesAlvo, bingoMaxPorMes: TUNING.bingoMaxPorMes, diasMinEntreBingos: TUNING.diasMinEntreBingos, diasAlvoEntreBingos: TUNING.diasAlvoEntreBingos, diasForcarBingo: TUNING.diasForcarBingo },
  '3-4': { bingoPorMesAlvo: 3.5, bingoMaxPorMes: 4, diasMinEntreBingos: 5, diasAlvoEntreBingos: 8, diasForcarBingo: 11 },
};

/** PIN do painel quando o neto não trocou (data.adminPin == null). Ver ADMIN_PIN acima. */
export function effectivePin(saved: string | null | undefined): string {
  return saved && /^\d{4}$/.test(saved) ? saved : ADMIN_PIN;
}

/** Fator do custo da bola extra (8% do maior ganho adicional; "mais barata" = 4%). */
export const COST_FACTOR: Record<RuntimeTuning['custoExtra'], number> = { normal: 0.08, barata: 0.04 };
