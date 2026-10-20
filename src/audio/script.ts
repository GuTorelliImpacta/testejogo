// Roteiro de falas do narrador. Fonte única para: narrador, pré-carregador e scripts/audio/generate.ts.
// Este arquivo é TS puro (sem DOM) para poder ser lido pelo Node.
import { PLAYER } from '../config';
import { PATTERN_ORDER, MAX_NUMBER } from '../types';
import type { PatternId } from '../types';

export type VoiceCategory =
  | 'number'
  | 'greeting'
  | 'start'
  | 'almost'
  | 'prize'
  | 'bingo'
  | 'jackpot'
  | 'extra'
  | 'noprize'
  | 'gift'
  | 'bordao'
  | 'turbo'
  | 'mail';

/** 1 = comentário, 2 = número, 3 = falta 1, 4 = prêmio, 5 = bingo/acumulado. */
export const PRIORITY = { comment: 1, number: 2, almost: 3, prize: 4, bingo: 5 } as const;
export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export interface VoiceLine {
  /** Também é o nome do arquivo (sem extensão): voice/<id>.webm|mp3. */
  id: string;
  /** Legenda exibida (pode conter vogais esticadas). */
  text: string;
  category: VoiceCategory;
  priority: Priority;
  /** Texto para o sintetizador (TTS neural ou speechSynthesis); padrão = text. */
  speak?: string;
  /** Intensidade da entrega: 'big' = grito de prêmio. */
  energy?: 'normal' | 'big';
}

const NUM_WORDS: string[] = [
  '', 'Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove', 'Dez',
  'Onze', 'Doze', 'Treze', 'Catorze', 'Quinze', 'Dezesseis', 'Dezessete', 'Dezoito', 'Dezenove',
];
const TENS: Record<number, string> = {
  2: 'Vinte', 3: 'Trinta', 4: 'Quarenta', 5: 'Cinquenta', 6: 'Sessenta',
  7: 'Setenta', 8: 'Oitenta', 9: 'Noventa',
};

/** 1..90 por extenso, com inicial maiúscula. */
export function numberWord(n: number): string {
  if (n < 20) return NUM_WORDS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${TENS[t]} e ${NUM_WORDS[u].toLowerCase()}`;
}

export const numberId = (n: number): string => `n${String(n).padStart(2, '0')}`;

export type Period = 'morning' | 'afternoon' | 'night';
export const periodOf = (hour: number): Period =>
  hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'night';
const PERIOD_WORD: Record<Period, string> = {
  morning: 'Bom dia',
  afternoon: 'Boa tarde',
  night: 'Boa noite',
};

const L = (
  id: string,
  text: string,
  category: VoiceCategory,
  priority: Priority,
  extra: Partial<Pick<VoiceLine, 'speak' | 'energy'>> = {},
): VoiceLine => ({ id, text, category, priority, ...extra });

const lines: VoiceLine[] = [];

for (let n = 1; n <= MAX_NUMBER; n++) {
  lines.push(L(numberId(n), `${numberWord(n)}!`, 'number', PRIORITY.number));
}

(['morning', 'afternoon', 'night'] as Period[]).forEach((p) => {
  lines.push(L(`greet_${p}`, `${PERIOD_WORD[p]}, ${PLAYER}! Vamos jogar?`, 'greeting', PRIORITY.comment));
  lines.push(
    L(`gift_daily_${p}`, `${PERIOD_WORD[p]}, ${PLAYER}! Seu presente de hoje!`, 'gift', PRIORITY.comment),
  );
});

lines.push(
  L('start_1', `Boa sorte, ${PLAYER}!`, 'start', PRIORITY.comment),
  L('start_2', 'Vamos lá!', 'start', PRIORITY.comment),
  L('start_3', 'Valendo!', 'start', PRIORITY.comment),

  L('almost_1', 'Falta uma!', 'almost', PRIORITY.almost),
  L('almost_2', 'Tá quase!', 'almost', PRIORITY.almost),
  L('almost_bingo_1', 'Falta uma pro bingo!', 'almost', PRIORITY.almost, { energy: 'big' }),
  L('almost_bingo_2', 'Tá quase o bingo!', 'almost', PRIORITY.almost, { energy: 'big' }),

  L('extra_1', `Bola extra! Vai, ${PLAYER}!`, 'extra', PRIORITY.comment),
  L('extra_2', 'Mais uma chance!', 'extra', PRIORITY.comment),
  L('extra_free', 'Bola extra grátis!', 'extra', PRIORITY.comment, { energy: 'big' }),
  L('extra_linhadupla', 'Linha dupla, valendo!', 'extra', PRIORITY.comment, { energy: 'big' }),

  L('mail_1', 'Correio da sorte!', 'mail', PRIORITY.comment),
  L('turbo_1', 'Turbo!', 'turbo', PRIORITY.comment, { energy: 'big' }),

  L('noprize_1', 'Na próxima vai!', 'noprize', PRIORITY.comment),
  L('noprize_2', 'Quase, quase!', 'noprize', PRIORITY.comment),
  L('noprize_3', 'Vamos de novo?', 'noprize', PRIORITY.comment),

  L('gift_1', `Presente pra ${PLAYER}!`, 'gift', PRIORITY.comment),
  L('gift_2', `Olha o presente, ${PLAYER}!`, 'gift', PRIORITY.comment),
);

/** Variações por padrão (2 a 3 cada). */
const PRIZE_TEXT: Record<PatternId, Array<[string, string?]>> = {
  linha: [['Linhaaa!', 'Linha!'], ['Linha! Muito bem!'], ['Fez linha!']],
  cantos: [['Cantos!'], ['Os quatro cantos!'], ['Cantooos!', 'Cantos!']],
  piramide: [['Pirâmide!'], ['Pirâmide! Olha só!'], ['Piraaâmide!', 'Pirâmide!']],
  u: [['Deu U!'], ['Deu Úúú!', 'Deu U!'], ['U! Que lindo!']],
  linhaDupla: [['Linha duplaaa!', 'Linha dupla!'], ['Linha dupla! Que sorte!'], ['Duas linhas!']],
  moldura: [['Moldura! Que beleza!'], ['Moldurinha completa!'], ['Moldura! Uhuuu!']],
  bingo: [['BINGOOO!!!', 'Bingo!'], ['BINGO! Parabéns!'], ['É bingooo!', 'É bingo!']],
};

for (const p of PATTERN_ORDER) {
  const isBingo = p === 'bingo';
  PRIZE_TEXT[p].forEach(([text, speak], i) => {
    lines.push(
      L(`prize_${p}_${i + 1}`, text, isBingo ? 'bingo' : 'prize', isBingo ? PRIORITY.bingo : PRIORITY.prize, {
        energy: 'big',
        ...(speak ? { speak } : {}),
      }),
    );
  });
}

lines.push(
  L('jackpot_1', `ACUMULADOOO! A ${PLAYER} levou tudo!`, 'jackpot', PRIORITY.bingo, {
    energy: 'big',
    speak: `Acumulado! A ${PLAYER} levou tudo!`,
  }),
  L('jackpot_2', `ACUMULADO! Parabéns, ${PLAYER}!`, 'jackpot', PRIORITY.bingo, { energy: 'big' }),
);

/**
 * Bordões tradicionais do bingo brasileiro (domínio público: ditos populares, sem autoria).
 * Só entram os muito conhecidos; na dúvida, fica de fora. Cada um ainda diz o número.
 * Uso: ~1 em cada 8 bolas que têm bordão (ver `pickNumberLine`), se `Settings.bordoes` estiver ligado.
 */
export const BORDOES: Readonly<Record<number, string>> = {
  15: 'Quinze, a debutante!',
  22: 'Dois patinhos na lagoa! Vinte e dois!',
  33: 'Trinta e três, idade de Cristo!',
  77: 'Setenta e sete, dois machadinhos!',
  90: 'Noventa, o velhinho!',
};
/** Chance de usar o bordão quando a bola tem um. */
export const BORDAO_CHANCE = 1 / 8;
export const bordaoId = (n: number): string => `bordao_${String(n).padStart(2, '0')}`;
for (const [n, text] of Object.entries(BORDOES)) {
  lines.push(L(bordaoId(Number(n)), text, 'bordao', PRIORITY.number));
}

/** Escolhe a fala de uma bola: número simples ou (às vezes) o bordão. */
export function pickNumberLine(ball: number, bordoes: boolean, rnd: () => number = Math.random): string {
  if (bordoes && BORDOES[ball] && rnd() < BORDAO_CHANCE) return bordaoId(ball);
  return numberId(ball);
}

export const VOICE_LINES: readonly VoiceLine[] = lines;
export const LINE_BY_ID: ReadonlyMap<string, VoiceLine> = new Map(lines.map((l) => [l.id, l]));

/** Ids de cada grupo de variações. */
export const prizeIds = (p: PatternId): string[] =>
  lines.filter((l) => l.id.startsWith(`prize_${p}_`)).map((l) => l.id);
export const groupIds = (prefix: string): string[] =>
  lines.filter((l) => l.id.startsWith(prefix)).map((l) => l.id);

export const GROUPS = {
  start: groupIds('start_'),
  almost: ['almost_1', 'almost_2'],
  almostBingo: ['almost_bingo_1', 'almost_bingo_2'],
  extraOffer: ['extra_1'],
  extraFree: ['extra_free'],
  extraLinhaDupla: ['extra_linhadupla'],
  mail: ['mail_1'],
  turbo: ['turbo_1'],
  extraBought: ['extra_2'],
  noprize: groupIds('noprize_'),
  gift: ['gift_1', 'gift_2'],
  jackpot: ['jackpot_1', 'jackpot_2'],
} as const;

/** Ordem de pré-carregamento: o que toca primeiro vem primeiro; números por último. */
export function preloadOrder(): string[] {
  const rank = (l: VoiceLine) =>
    l.category === 'greeting' || l.category === 'start'
      ? 0
      : l.category === 'number' || l.category === 'bordao'
        ? 3
        : 1;
  return [...lines].sort((a, b) => rank(a) - rank(b)).map((l) => l.id);
}

/** Sorteia uma variação evitando repetir a anterior do mesmo grupo. */
export function pickVariant(ids: readonly string[], last?: string, rnd: () => number = Math.random): string {
  if (ids.length <= 1) return ids[0];
  const pool = last ? ids.filter((i) => i !== last) : ids;
  return pool[Math.floor(rnd() * pool.length)];
}
