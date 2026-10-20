import { BALLS_EXTRA_MAX, BALLS_MAIN, MAX_NUMBER } from './types';
import { BET_OPTIONS, DEFAULT_BET, DEFAULT_SETTINGS, JACKPOT_BASE, START_CREDITS } from './config';
import { generateCards, isValidCard } from './cards';
import { cryptoRng } from './rng';
import { initialDirector } from './director';
import type { MailState, SaveData, Stats } from './types';

const KEY = 'altina-da-sorte:v2';
const KEY_V1 = 'altina-da-sorte:v1';

export function emptyMail(): MailState {
  return { day: '', bonusToday: 0, playMs: 0, pending: null };
}

export function emptyStats(): Stats {
  return {
    rodadas: 0,
    apostado: 0,
    ganho: 0,
    apostadoTotal: 0,
    ganhoTotal: 0,
    rodadasPorDia: {},
    recargas: 0,
    porPadrao: {},
  };
}

export function freshSave(now: number): SaveData {
  return {
    version: 2,
    credits: START_CREDITS,
    bet: DEFAULT_BET,
    cards: generateCards(cryptoRng),
    active: [true, true, true, true],
    jackpot: JACKPOT_BASE,
    settings: { ...DEFAULT_SETTINGS },
    director: initialDirector(now),
    stats: emptyStats(),
    lastDailyBonus: '',
    mail: emptyMail(),
    turboRounds: 0,
    round: null,
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Valor de aposta válido (1..10) mais próximo. */
function nearestBet(v: unknown): number {
  if (typeof v !== 'number' || !isFinite(v)) return DEFAULT_BET;
  let best = BET_OPTIONS[0];
  for (const b of BET_OPTIONS) if (Math.abs(b - v) < Math.abs(best - v)) best = b;
  return best;
}

function validMail(m: unknown): MailState {
  const r = (m ?? {}) as Partial<MailState>;
  const p = r.pending;
  const pendingOk =
    !!p && (p.kind === 'daily' || p.kind === 'bonus') && typeof p.amount === 'number' && isFinite(p.amount) && p.amount > 0;
  return {
    day: typeof r.day === 'string' ? r.day : '',
    bonusToday: Math.max(0, Math.floor(num(r.bonusToday, 0))),
    playMs: Math.max(0, num(r.playMs, 0)),
    pending: pendingOk ? { kind: p!.kind, amount: p!.amount } : null,
  };
}

/**
 * Valida e completa dados vindos do disco/importação. Aceita v1 e v2; devolve null se inutilizável.
 * v1 -> v2: preserva saldo, acumulado, diretor, estatísticas, configurações e bônus diário;
 * DESCARTA a rodada em andamento, gera cartelas novas (1–90) e ajusta a aposta (20 -> 10).
 */
export function migrate(raw: unknown, now: number): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Omit<SaveData, 'version'>> & { version?: number };
  if (r.version !== 1 && r.version !== 2) return null;
  const base = freshSave(now);
  const common = {
    version: 2 as const,
    credits: Math.max(0, Math.floor(num(r.credits, base.credits))),
    jackpot: Math.max(JACKPOT_BASE, num(r.jackpot, base.jackpot)),
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    director: { ...base.director, ...(r.director ?? {}) },
    stats: { ...emptyStats(), ...(r.stats ?? {}) },
    lastDailyBonus: typeof r.lastDailyBonus === 'string' ? r.lastDailyBonus : '',
  };
  if (r.version === 1) {
    return { ...base, ...common, bet: nearestBet(r.bet), round: null };
  }
  const cardsOk =
    Array.isArray(r.cards) && r.cards.length === 4 && r.cards.every((c) => c && Array.isArray(c.nums) && isValidCard(c));
  const betOk = Number.isInteger(r.bet) && BET_OPTIONS.includes(r.bet as number);
  const activeOk = Array.isArray(r.active) && r.active.length === 4 && r.active.some(Boolean);
  const round = validRound(r.round) ? r.round : null;
  return {
    ...base,
    ...common,
    bet: betOk ? (r.bet as number) : base.bet,
    cards: cardsOk ? r.cards! : base.cards,
    active: activeOk ? r.active!.map(Boolean) : base.active,
    mail: validMail(r.mail),
    turboRounds: Math.max(0, Math.floor(num(r.turboRounds, 0))),
    round,
  };
}

function validRound(x: unknown): x is NonNullable<SaveData['round']> {
  const r = x as SaveData['round'];
  if (!r || typeof r !== 'object') return false;
  const nums = (a: unknown, n: number, max = Infinity) =>
    Array.isArray(a) &&
    a.length >= n &&
    a.length <= max &&
    a.every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_NUMBER);
  const extras = r.plan?.extras;
  const free = r.plan?.free;
  return (
    Number.isInteger(r.bet) && BET_OPTIONS.includes(r.bet) &&
    typeof r.jackpot === 'number' && isFinite(r.jackpot) &&
    typeof r.extraSpent === 'number' && isFinite(r.extraSpent) && r.extraSpent >= 0 &&
    nums(r.plan?.main, BALLS_MAIN, BALLS_MAIN) &&
    nums(extras, 0, BALLS_EXTRA_MAX) &&
    (free === undefined || (Array.isArray(free) && free.every((f) => typeof f === 'boolean'))) &&
    Number.isInteger(r.mainIdx) && r.mainIdx >= 0 && r.mainIdx <= BALLS_MAIN &&
    Number.isInteger(r.extrasUsed) && r.extrasUsed >= 0 && r.extrasUsed <= (extras?.length ?? 0) &&
    Array.isArray(r.active) && r.active.length === 4 && r.active.some(Boolean) &&
    Array.isArray(r.cards) && r.cards.length === 4 && r.cards.every((c) => c && Array.isArray(c.nums) && isValidCard(c))
  );
}

export function load(now: number): SaveData {
  try {
    for (const key of [KEY, KEY_V1]) {
      const s = localStorage.getItem(key);
      if (!s) continue;
      const d = migrate(JSON.parse(s), now);
      if (d) return d;
    }
  } catch {
    /* sem armazenamento: segue o jogo */
  }
  return freshSave(now);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: SaveData | null = null;

function flush(): void {
  timer = null;
  if (!pending) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    /* ignora */
  }
  pending = null;
}

/** Salva com debounce (200 ms). */
export function save(data: SaveData): void {
  pending = data;
  if (!timer) timer = setTimeout(flush, 200);
}

export function saveNow(data: SaveData): void {
  pending = data;
  if (timer) clearTimeout(timer);
  flush();
}

if (typeof addEventListener === 'function') {
  addEventListener('pagehide', flush);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
