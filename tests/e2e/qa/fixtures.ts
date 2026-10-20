// Fixtures do QA (v2): monta saves v2 artificiais (rodada com plano determinístico, saldo, correio...).
// Usado por rules.ts, game.ts, flows.ts, layout.ts, robust.ts.
import { freshSave } from '../../../src/storage';
import { generateCards } from '../../../src/cards';
import { seededRng } from '../../../src/rng';
import type { Card, DrawPlan, SaveData } from '../../../src/types';

export const KEY = 'altina-da-sorte:v2';
export const KEY_V1 = 'altina-da-sorte:v1';
export const BASE = process.env.QA_BASE ?? 'http://localhost:4181';
export const EXE = '/opt/pw-browsers/chromium';
const DEFAULT_VIEWPORTS = [
  { w: 1280, h: 800 },
  { w: 800, h: 1280 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 360, h: 740 },
];
/** QA_VP="1180x820,390x844" troca a lista de viewports. */
export const VIEWPORTS = process.env.QA_VP
  ? process.env.QA_VP.split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { w, h }; })
  : DEFAULT_VIEWPORTS;

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Save base: 4 cartelas determinísticas, correio diário JÁ pego hoje (sem carta pendente). */
export function baseSave(seed = 1): SaveData {
  const s = freshSave(Date.now());
  s.cards = generateCards(seededRng(seed));
  s.lastDailyBonus = today();
  s.mail = { day: today(), bonusToday: 0, playMs: 0, pending: null };
  return s;
}

/** Números que NÃO estão em nenhuma das cartelas (fillers seguros para não marcar nada sem querer). */
export function fillers(cards: Card[], n: number, from = 1): number[] {
  const used = new Set(cards.flatMap((c) => c.nums));
  const out: number[] = [];
  for (let k = from; out.length < n && k <= 90; k++) if (!used.has(k)) out.push(k);
  return out;
}

/**
 * Plano determinístico: `marks` entram nas primeiras posições relevantes; o resto é filler.
 * `at30`: números a serem sorteados exatamente nas últimas posições (a decisiva é a última).
 */
export function mkPlan(cards: Card[], opts: { early?: number[]; late?: number[]; extras?: number[]; free?: boolean[] }): DrawPlan {
  const early = opts.early ?? [];
  const late = opts.late ?? [];
  const f = fillers(cards, 60);
  if (f.length < 40 - early.length) throw new Error('poucos fillers: ' + f.length);
  const main: number[] = [...early];
  let fi = 0;
  while (main.length < 30 - late.length) main.push(f[fi++]);
  main.push(...late);
  const extras = opts.extras ?? f.slice(fi, fi + 9);
  const plan: DrawPlan = { main, extras };
  if (opts.free) plan.free = opts.free;
  return plan;
}

export interface RoundOpts {
  mainIdx?: number;
  extrasUsed?: number;
  bet?: number;
  jackpot?: number;
  extraSpent?: number;
  credits?: number;
  turbo?: boolean;
}

/** Aplica uma rodada em andamento ao save (já debitada: `credits` é o saldo atual). */
export function withRound(s: SaveData, plan: DrawPlan, o: RoundOpts = {}): SaveData {
  s.round = {
    bet: o.bet ?? s.bet,
    jackpot: o.jackpot ?? 5400,
    plan,
    mainIdx: o.mainIdx ?? 0,
    extrasUsed: o.extrasUsed ?? 0,
    extraSpent: o.extraSpent ?? 0,
    cards: s.cards,
    active: s.active.slice(),
  };
  s.bet = s.round.bet;
  if (o.credits !== undefined) s.credits = o.credits;
  if (o.turbo !== undefined) s.settings.turbo = o.turbo;
  return s;
}

/** Cartela 0 a 1 número do BINGO (14 marcadas depois de `mainIdx`); a decisiva é a ÚLTIMA (30ª) bola. */
export function nearBingo(opts: { mainIdx?: number; jackpot?: number; bet?: number; free?: boolean[]; extrasDecisive?: boolean; turbo?: boolean; credits?: number } = {}): SaveData {
  const s = baseSave(3);
  const c0 = s.cards[0].nums;
  const plan = opts.extrasDecisive
    ? mkPlan(s.cards, { early: c0.slice(0, 14), extras: [c0[14], ...fillers(s.cards, 8, 40)], free: opts.free })
    : mkPlan(s.cards, { early: c0.slice(0, 14), late: [c0[14]], free: opts.free });
  s.bet = opts.bet ?? 5;
  return withRound(s, plan, { mainIdx: opts.mainIdx ?? 30, jackpot: opts.jackpot ?? 5400, bet: opts.bet ?? 5, credits: opts.credits ?? 800, turbo: opts.turbo });
}

/** Cartela 0 com uma linha completa + a 2ª linha a 1 número depois de 30 bolas -> oferta (Linha dupla). */
export function nearDouble(opts: { free?: boolean[]; credits?: number; bet?: number; turbo?: boolean; mainIdx?: number } = {}): SaveData {
  const s = baseSave(5);
  const c0 = s.cards[0].nums;
  const marks = [...c0.slice(0, 5), ...c0.slice(5, 9)]; // linha 0 completa + 4 da linha 1
  const plan = mkPlan(s.cards, { early: marks, extras: [c0[9], ...fillers(s.cards, 8, 40)], free: opts.free });
  s.bet = opts.bet ?? 5;
  return withRound(s, plan, { mainIdx: opts.mainIdx ?? 30, bet: opts.bet ?? 5, credits: opts.credits ?? 800, turbo: opts.turbo });
}

/** Rodada que acabou de começar com um plano que NÃO paga nada (para testar fluxo/turbo). */
export function blankRound(opts: { turbo?: boolean; credits?: number; mainIdx?: number } = {}): SaveData {
  const s = baseSave(2);
  const plan = mkPlan(s.cards, {});
  return withRound(s, plan, { mainIdx: opts.mainIdx ?? 0, credits: opts.credits ?? 980, turbo: opts.turbo });
}
