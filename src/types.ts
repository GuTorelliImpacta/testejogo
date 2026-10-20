// Contratos compartilhados entre regras, diretor, UI e áudio.

/** Bitmask de 15 bits: bit (linha*5 + coluna). Linha 0 = topo. */
export type Mask = number;

export type PatternId =
  | 'linha'
  | 'cantos'
  | 'piramide'
  | 'u'
  | 'linhaDupla'
  | 'moldura'
  | 'bingo';

/** Ordem crescente de valor (índice = nível; 0 = nenhum). */
export const PATTERN_ORDER: PatternId[] = [
  'linha',
  'cantos',
  'piramide',
  'u',
  'linhaDupla',
  'moldura',
  'bingo',
];

/** Cartela: 15 números em ordem de linha (índice = linha*5 + coluna). */
export interface Card {
  nums: number[];
}

export const CARD_COUNT = 4;
export const BALLS_MAIN = 30;
export const BALLS_EXTRA_MAX = 10;
export const MAX_NUMBER = 60;

/** Sequência completa pré-gerada para uma rodada. */
export interface DrawPlan {
  main: number[]; // 30 bolas
  extras: number[]; // até 10 bolas extras
}

export interface CardResult {
  cardIndex: number;
  pattern: PatternId | null; // maior padrão completo
  prize: number; // créditos (sem acumulado)
  jackpot: boolean;
}

export interface RoundSummary {
  bet: number; // por cartela
  totalBet: number;
  results: CardResult[];
  prize: number; // soma dos prêmios (inclui acumulado)
  jackpot: number; // valor de acumulado pago (0 se nenhum)
  extrasUsed: number;
  extraCost: number;
  best: PatternId | null;
}

export type GamePhase =
  | 'splash'
  | 'idle'
  | 'drawing'
  | 'extraOffer'
  | 'extraDrawing'
  | 'settling'
  | 'celebrating'
  | 'gift';

export interface Settings {
  speed: 'lenta' | 'normal' | 'rapida';
  volMusic: number; // 0..1
  volVoice: number;
  volSfx: number;
  muted: boolean;
  captions: boolean;
  light: boolean; // modo leve
  textSize: 'normal' | 'grande' | 'muito';
}

export interface DirectorState {
  ultimoBingoEm: number | null; // epoch ms
  bingosPorMes: Record<string, number>; // "2026-10": n
  rodadasDesdeUltimoBingo: number;
  primeiroUsoEm: number; // epoch ms
  historicoBingos: number[]; // epoch ms
}

export interface Stats {
  rodadas: number;
  apostado: number;
  ganho: number; // prêmios comuns (sem bingo/acumulado)
  apostadoTotal: number;
  ganhoTotal: number;
  rodadasPorDia: Record<string, number>;
  recargas: number;
  porPadrao: Partial<Record<PatternId, number>>;
}

/** Rodada em andamento (para retomar ao reabrir). */
export interface SavedRound {
  bet: number;
  jackpot: number; // valor do acumulado em jogo
  plan: DrawPlan;
  mainIdx: number;
  extrasUsed: number;
  cards: Card[];
  active: boolean[];
}

export interface SaveData {
  version: 1;
  credits: number;
  bet: number;
  cards: Card[];
  active: boolean[];
  jackpot: number;
  settings: Settings;
  director: DirectorState;
  stats: Stats;
  lastDailyBonus: string; // "2026-10-20"
  round?: SavedRound | null;
}
