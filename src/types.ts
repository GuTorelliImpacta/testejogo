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
export const BALLS_EXTRA_MAX = 9;
export const MAX_NUMBER = 90;
/** Largura da faixa de cada coluna da cartela: coluna c usa 18c+1..18c+18. */
export const COL_SPAN = 18;

/** Sequência completa pré-gerada para uma rodada. */
export interface DrawPlan {
  main: number[]; // 30 bolas (1..90)
  extras: number[]; // até 9 bolas extras
  /** free[i] = a i-ésima oferta de bola extra é GRÁTIS. Opcional (ausente = nenhuma). */
  free?: boolean[];
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
  freeExtras: number; // quantas extras foram grátis
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
  turbo: boolean; // 30 bolas rápidas, voz só nos prêmios
  bordoes: boolean; // bordões tradicionais de bingo na voz
  volMusic: number; // 0..1
  volVoice: number;
  volSfx: number;
  muted: boolean;
  captions: boolean;
  light: boolean; // modo leve
  lightManual: boolean; // true = a pessoa escolheu; o automático não sobrescreve
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

/** Correio da sorte. */
export interface MailState {
  day: string; // dia ao qual `bonusToday`/`playMs` se referem
  bonusToday: number; // correios ocasionais já entregues hoje
  playMs: number; // tempo de jogo acumulado hoje
  pending: { kind: 'daily' | 'bonus'; amount: number } | null; // carta esperando ser aberta
}

/** Rodada em andamento (para retomar ao reabrir). */
export interface SavedRound {
  extraSpent: number;
  bet: number;
  jackpot: number; // valor do acumulado em jogo
  plan: DrawPlan;
  mainIdx: number;
  extrasUsed: number;
  cards: Card[];
  active: boolean[];
}

export interface SaveData {
  version: 3;
  credits: number;
  bet: number;
  cards: Card[];
  active: boolean[];
  jackpot: number;
  settings: Settings;
  director: DirectorState;
  stats: Stats;
  lastDailyBonus: string; // "2026-10-20" (dia em que o correio diário foi pego)
  mail: MailState;
  tuning: RuntimeTuning; // ajustes do painel do neto (valem a partir da próxima rodada)
  adminPin: string | null; // PIN trocado pelo neto; null = padrão de config.ts
  turboRounds: number; // rodadas jogadas (para liberar o modo leve automático após 3)
  round?: SavedRound | null;
}

// ---------- v3: painel do neto ----------
export type Level3 = 'menos' | 'normal' | 'mais';

/** Ajustes em tempo de execução (presets nomeados; o Diretor traduz para números). */
export interface RuntimeTuning {
  bingosPorMes: '1' | '2' | '2-3' | '3-4';
  premiosDoDia: Level3; // linha / linha dupla: RTP comum e % de rodadas sem prêmio
  ofertaExtra: Level3; // frequência de oferta de bola extra
  chanceGratis: Level3; // chance de a extra ser grátis
  custoExtra: 'barata' | 'normal';
  presente: 500 | 1000 | 2000; // recarga quando o saldo acaba
  correioDiario: 300 | 500;
  conjuntoPadroes: 'classico' | 'variado';
}

/** Estatísticas legíveis para o painel (substitui o JSON cru). */
export interface AdminStats {
  creditos: number;
  acumulado: number;
  bingosNoMes: number;
  ultimosBingos: string[]; // datas pt-BR, mais recente primeiro (até 8)
  diasDesdeUltimoBingo: number | null;
  rodadas: number;
  rodadasPorDia: number;
  premiosPorTipo: Partial<Record<PatternId, number>>;
  rtpComum: number;
  rtpTotal: number;
  recargas: number;
  tuning: RuntimeTuning;
}

/** Dados do aparelho para a aba "Aparelho" (preenchido por src/perf.ts). */
export interface DeviceInfo {
  userAgent: string;
  chromeVersion: string | null;
  deviceMemory: number | null;
  cores: number | null;
  screen: string; // "1280x800 @1"
  viewport: string;
  dpr: number;
  fpsMedio: number | null; // últimas rodadas
  piorQuadroMs: number | null;
  memoriaJsMB: number | null;
  modoEconomico: boolean;
  sw: string; // versão do service worker/cache, se conhecida
}
