import { DEFAULT_SETTINGS, JACKPOT_BASE, START_CREDITS } from './config';
import { generateCards } from './cards';
import { cryptoRng } from './rng';
import { initialDirector } from './director';
import type { SaveData, Stats } from './types';

const KEY = 'altina-da-sorte:v1';

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
    version: 1,
    credits: START_CREDITS,
    bet: 5,
    cards: generateCards(cryptoRng),
    active: [true, true, true, true],
    jackpot: JACKPOT_BASE,
    settings: { ...DEFAULT_SETTINGS },
    director: initialDirector(now),
    stats: emptyStats(),
    lastDailyBonus: '',
    round: null,
  };
}

/** Valida e completa dados vindos do disco/importação. Devolve null se inutilizável. */
export function migrate(raw: unknown, now: number): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SaveData>;
  if (r.version !== 1) return null;
  const base = freshSave(now);
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
  const cardsOk =
    Array.isArray(r.cards) &&
    r.cards.length === 4 &&
    r.cards.every((c) => c && Array.isArray(c.nums) && c.nums.length === 15);
  return {
    ...base,
    ...r,
    version: 1,
    credits: Math.max(0, Math.floor(num(r.credits, base.credits))),
    bet: [1, 2, 5, 10, 20].includes(r.bet as number) ? (r.bet as number) : base.bet,
    cards: cardsOk ? r.cards! : base.cards,
    active:
      Array.isArray(r.active) && r.active.length === 4 && r.active.some(Boolean)
        ? r.active.map(Boolean)
        : base.active,
    jackpot: Math.max(JACKPOT_BASE, num(r.jackpot, base.jackpot)),
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    director: { ...base.director, ...(r.director ?? {}) },
    stats: { ...emptyStats(), ...(r.stats ?? {}) },
    lastDailyBonus: typeof r.lastDailyBonus === 'string' ? r.lastDailyBonus : '',
    round: validRound(r.round) ? r.round : null,
  };
}

function validRound(x: unknown): x is NonNullable<SaveData['round']> {
  const r = x as SaveData['round'];
  if (!r || typeof r !== 'object') return false;
  const nums = (a: unknown, n: number) =>
    Array.isArray(a) && a.length >= n && a.every((v) => Number.isInteger(v) && v >= 1 && v <= 60);
  return (
    [1, 2, 5, 10, 20].includes(r.bet) &&
    typeof r.jackpot === 'number' &&
    nums(r.plan?.main, 30) &&
    nums(r.plan?.extras, 0) &&
    Number.isInteger(r.mainIdx) && r.mainIdx >= 0 && r.mainIdx <= 30 &&
    Number.isInteger(r.extrasUsed) && r.extrasUsed >= 0 && r.extrasUsed <= (r.plan?.extras?.length ?? 0) &&
    Array.isArray(r.active) && r.active.length === 4 && r.active.some(Boolean) &&
    Array.isArray(r.cards) && r.cards.length === 4 && r.cards.every((c) => nums(c?.nums, 15))
  );
}

export function load(now: number): SaveData {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
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
