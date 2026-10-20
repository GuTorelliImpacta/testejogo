// Harness de desenvolvimento: monta a UI com um GameApi MOCK (nao usado em producao).
// Abrir: /src/ui/dev.html?s=idle|drawing|extra|gift|daily|bingo|line|splash|prizes|settings|pin|admin&ts=grande&light=1
import { bus } from '../events';
import { DEFAULT_SETTINGS, BET_OPTIONS, MULTIPLIER } from '../config';
import { generateCards, markedMask } from '../cards';
import { bestPattern, bestReachableByOne } from '../patterns';
import { seededRng, shuffle } from '../rng';
import type { GameApi, GameView } from '../gameApi';
import type { PatternId, RoundSummary } from '../types';
import { mountUI } from './index';

const q = new URLSearchParams(location.search);
const rng = seededRng(Number(q.get('seed') ?? 11));

const view: GameView = {
  phase: 'idle',
  credits: 1250,
  bet: 5,
  totalBet: 20,
  jackpot: 5432,
  cards: generateCards(rng),
  active: [true, true, true, true],
  drawn: [],
  current: null,
  mainCount: 0,
  extraOffer: null,
  summary: null,
  auto: false,
  settings: { ...DEFAULT_SETTINGS },
  giftAmount: 0,
};
if (q.get('ts')) view.settings.textSize = q.get('ts') as 'grande' | 'muito';
if (q.get('light')) view.settings.light = true;

const emit = () => bus.emit('stateChanged');
const recalc = () => {
  view.totalBet = view.bet * view.active.filter(Boolean).length;
};
let timer = 0;

function summarize(): RoundSummary {
  const set = new Set(view.drawn);
  let prize = 0;
  let best: PatternId | null = null;
  const results = view.cards.map((c, i) => {
    const p = view.active[i] ? bestPattern(markedMask(c, set)) : null;
    const pr = p ? view.bet * MULTIPLIER[p] : 0;
    prize += pr;
    if (p && (!best || MULTIPLIER[p] > MULTIPLIER[best])) best = p;
    return { cardIndex: i, pattern: p, prize: pr, jackpot: false };
  });
  return { bet: view.bet, totalBet: view.totalBet, results, prize, jackpot: 0, extrasUsed: 0, extraCost: 0, best };
}

function finish(): void {
  const s = summarize();
  view.summary = s;
  view.credits += s.prize;
  const big = s.best && MULTIPLIER[s.best] >= 15;
  view.phase = big ? 'celebrating' : 'idle';
  emit();
  bus.emit('roundEnd', { summary: s, won: s.prize > 0 });
}

function nextBall(extra: boolean): void {
  const order = (view as unknown as { _order: number[] })._order;
  const ball = order[view.drawn.length];
  view.drawn.push(ball);
  view.current = ball;
  if (!extra) view.mainCount = view.drawn.length;
  emit();
  bus.emit('ballDrawn', { ball, index: view.drawn.length - 1, extra, fast: false });
  if (!extra && view.drawn.length < 30) timer = window.setTimeout(() => nextBall(false), 450);
  else if (!extra) {
    const set = new Set(view.drawn);
    const can = view.cards.some((c, i) => view.active[i] && bestReachableByOne(markedMask(c, set)));
    if (can) {
      view.phase = 'extraOffer';
      view.extraOffer = { cost: 5, remaining: 10 };
      emit();
      bus.emit('extraOffer', { cost: 5, remaining: 10 });
    } else finish();
  } else {
    view.phase = 'extraOffer';
    emit();
    if (view.drawn.length - 30 >= 10) finish();
  }
}

const api: GameApi = {
  getView: () => view,
  enter() {
    view.phase = 'idle';
    emit();
  },
  play() {
    view.credits -= view.totalBet;
    view.drawn = [];
    view.current = null;
    view.mainCount = 0;
    view.summary = null;
    view.phase = 'drawing';
    (view as unknown as { _order: number[] })._order = shuffle(Array.from({ length: 60 }, (_, i) => i + 1), rng);
    emit();
    bus.emit('roundStart', { bet: view.bet, totalBet: view.totalBet });
    timer = window.setTimeout(() => nextBall(false), 400);
  },
  accelerate() {},
  buyExtra() {
    view.extraOffer = null;
    view.phase = 'extraDrawing';
    emit();
    nextBall(true);
  },
  finishExtra() {
    view.extraOffer = null;
    finish();
  },
  continueCelebration() {
    view.phase = 'idle';
    emit();
  },
  takeGift() {
    view.credits += view.giftAmount;
    view.giftAmount = 0;
    view.phase = 'idle';
    emit();
  },
  toggleCard(i) {
    if (view.active[i] && view.active.filter(Boolean).length === 1) return;
    view.active[i] = !view.active[i];
    recalc();
    emit();
  },
  changeBet(dir) {
    const i = Math.max(0, Math.min(BET_OPTIONS.length - 1, BET_OPTIONS.indexOf(view.bet) + dir));
    view.bet = BET_OPTIONS[i];
    recalc();
    emit();
  },
  swapCards() {
    view.cards = generateCards(rng);
    emit();
  },
  setAuto(on) {
    view.auto = on;
    emit();
  },
  updateSettings(p) {
    view.settings = { ...view.settings, ...p };
    emit();
  },
  admin: {
    unlock: (pin) => pin === '1958',
    snapshot: () => ({ credits: view.credits, jackpot: view.jackpot, rodadas: 12, bingos: ['2026-10-02', '2026-10-15'], rtp: 0.87 }),
    exportJson: () => JSON.stringify({ version: 1, credits: view.credits }),
    importJson: (s) => {
      try {
        JSON.parse(s);
        return true;
      } catch {
        return false;
      }
    },
    resetJackpot: () => {
      view.jackpot = 5000;
      emit();
    },
    resetCredits: () => {
      view.credits = 1000;
      emit();
    },
  },
};

const root = document.getElementById('app')!;
const ui = mountUI(root, api);
bus.on('stateChanged', () => ui.render());

/** Cenarios deterministicos para screenshots. */
function scenario(name: string): void {
  window.clearTimeout(timer);
  const c = view.cards;
  const n = (ci: number, ks: number[]) => ks.map((k) => c[ci].nums[k]);
  if (name === 'splash') view.phase = 'splash';
  if (['drawing', 'extra', 'bingo', 'line'].includes(name)) {
    const base = [
      ...n(0, [0, 1, 2, 3, 4, 5, 6, 7, 8]), // linha 0 + 4 da linha 1 => linha dupla falta 1 (indice 9 fora)
      ...n(1, [0, 4, 10, 7]), // cantos faltando 1 (canto inferior direito fora)
      ...n(2, [0, 3, 6, 9, 12]),
      ...n(3, [1, 2, 11]),
    ];
    const set = new Set(base);
    set.delete(c[0].nums[9]);
    set.delete(c[1].nums[14]);
    const onCards = new Set(c.flatMap((k) => k.nums));
    const rest = shuffle(Array.from({ length: 60 }, (_, i) => i + 1).filter((x) => !onCards.has(x)), seededRng(5));
    while (set.size < 24 && rest.length) set.add(rest.pop()!);
    view.drawn = shuffle([...set], seededRng(3));
    view.current = view.drawn[view.drawn.length - 1];
    view.mainCount = Math.min(30, view.drawn.length);
    view.phase = 'drawing';
    view.credits = 1230;
    if (name === 'drawing') view.active[3] = false;
    if (name === 'extra') {
      view.phase = 'extraOffer';
      view.extraOffer = { cost: 5, remaining: 10 };
    }
    if (name === 'bingo' || name === 'line') {
      view.phase = 'celebrating';
      view.summary = {
        bet: 5,
        totalBet: 20,
        results: [],
        prize: name === 'bingo' ? 1500 + 5432 : 75,
        jackpot: name === 'bingo' ? 5432 : 0,
        extrasUsed: 0,
        extraCost: 0,
        best: name === 'bingo' ? 'bingo' : 'linhaDupla',
      };
    }
  }
  if (name === 'gift') {
    view.phase = 'gift';
    view.giftAmount = 1000;
    view.credits = 12;
  }
  if (name === 'daily') {
    bus.emit('dailyBonus', { amount: 300 });
    view.phase = 'gift';
    view.giftAmount = 300;
  }
  emit();
  if (name === 'prizes') document.querySelectorAll<HTMLElement>('.bar .btn')[4].click();
  if (name === 'settings') document.querySelectorAll<HTMLElement>('.top .btn')[1].click();
  if (name === 'pin' || name === 'admin') {
    for (let i = 0; i < 5; i++) document.querySelector<HTMLElement>('.top .logo')!.click();
    if (name === 'admin') {
      for (const k of '1958') [...document.querySelectorAll<HTMLElement>('.keys .btn')].find((b) => b.textContent === k)!.click();
    }
  }
}
(window as unknown as { __dev: unknown }).__dev = { scenario, api, view };
const s = q.get('s');
if (s) scenario(s);
