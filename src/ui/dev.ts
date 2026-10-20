// Harness de desenvolvimento: monta a UI com um GameApi MOCK (nao usado em producao).
// Abrir: /src/ui/dev.html?s=idle|drawing|extra|extra-free|mail-arrived|mail-open|bingo|bingo-cards|line|line-cards|gift|daily|prizes|settings|settings-jogo|settings-tela|pin|admin|splash
//        &ts=grande&light=1&big=1 (7 digitos) &set=variado
//        admin[-resumo|jogo|pin|aparelho][-pagina], settings-admin
import { bus } from '../events';
import { DEFAULT_SETTINGS, DEFAULT_TUNING, BET_OPTIONS, MULTIPLIER, PATTERN_SETS, jackpotShare } from '../config';
import { generateCards, markedMask } from '../cards';
import { isComplete, levelOf, missing } from '../patterns';
import { seededRng, shuffle } from '../rng';
import type { GameApi, GameView } from '../gameApi';
import type { Card, PatternId, RoundSummary, RuntimeTuning } from '../types';
import { mountUI, setSpokenCaption } from './index';

const q = new URLSearchParams(location.search);
const rng = seededRng(Number(q.get('seed') ?? 11));
let setName: 'classico' | 'variado' = q.get('set') === 'variado' ? 'variado' : 'classico';
let tuning: RuntimeTuning = { ...DEFAULT_TUNING, conjuntoPadroes: setName };
let adminPin = '1958';

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
  extraTotal: 9,
  extrasDrawn: 0,
  turbo: false,
  cardCount: 4,
  prizeTable: [],
  jackpotShare: 1,
  mail: null,
  summary: null,
  auto: false,
  settings: { ...DEFAULT_SETTINGS },
  giftAmount: 0,
};
if (q.get('ts')) view.settings.textSize = q.get('ts') as 'grande' | 'muito';
if (q.get('light')) view.settings.light = true;
if (q.get('big')) {
  view.credits = 1234567;
  view.jackpot = 1234567;
}

const pats = (): PatternId[] => PATTERN_SETS[setName];
const emit = () => {
  view.prizeTable = pats().map((p) => ({ pattern: p, prize: view.bet * MULTIPLIER[p] }));
  view.jackpotShare = jackpotShare(view.bet);
  view.totalBet = view.bet * view.cardCount;
  view.active = [0, 1, 2, 3].map((i) => i < view.cardCount);
  bus.emit('stateChanged');
};
let timer = 0;

const bestOf = (m: number): PatternId | null => [...pats()].sort((a, b) => levelOf(b) - levelOf(a)).find((p) => isComplete(m, p)) ?? null;

function summarize(): RoundSummary {
  const set = new Set(view.drawn);
  let prize = 0;
  let best: PatternId | null = null;
  const results = view.cards.map((c, i) => {
    const p = view.active[i] ? bestOf(markedMask(c, set)) : null;
    const pr = p ? view.bet * MULTIPLIER[p] : 0;
    prize += pr;
    if (p && (!best || MULTIPLIER[p] > MULTIPLIER[best])) best = p;
    return { cardIndex: i, pattern: p, prize: pr, jackpot: false };
  });
  return { bet: view.bet, totalBet: view.totalBet, results, prize, jackpot: 0, extrasUsed: view.extrasDrawn, extraCost: 0, freeExtras: 0, best };
}

function finish(): void {
  const s = summarize();
  view.summary = s;
  view.credits += s.prize;
  view.extraOffer = null;
  const big = s.best && MULTIPLIER[s.best] >= 15;
  view.phase = big ? 'celebrating' : 'idle';
  emit();
  bus.emit('roundEnd', { summary: s, won: s.prize > 0 });
}

function offerFor(): GameView['extraOffer'] {
  const set = new Set(view.drawn);
  const improves: NonNullable<GameView['extraOffer']>['improves'] = [];
  view.cards.forEach((c, i) => {
    if (!view.active[i]) return;
    const m = markedMask(c, set);
    const cur = levelOf(bestOf(m));
    const nxt = [...pats()].sort((a, b) => levelOf(b) - levelOf(a)).find((p) => levelOf(p) > cur && missing(m, p) === 1);
    if (nxt) improves.push({ cardIndex: i, pattern: nxt, gain: view.bet * MULTIPLIER[nxt] });
  });
  if (!improves.length || view.extrasDrawn >= 9) return null;
  return { cost: 8, free: view.extrasDrawn === 2, remaining: 9 - view.extrasDrawn, improves };
}

function nextBall(extra: boolean): void {
  const order = (view as unknown as { _order: number[] })._order;
  const ball = order[view.drawn.length];
  view.drawn.push(ball);
  view.current = ball;
  if (extra) view.extrasDrawn++;
  else view.mainCount = view.drawn.length;
  emit();
  bus.emit('ballDrawn', { ball, index: extra ? view.extrasDrawn - 1 : view.drawn.length - 1, total: extra ? 9 : 30, extra, fast: view.turbo });
  const gap = view.turbo ? 120 : 450;
  if (!extra && view.drawn.length < 30) timer = window.setTimeout(() => nextBall(false), gap);
  else {
    const o = offerFor();
    if (o) {
      view.phase = 'extraOffer';
      view.extraOffer = o;
      emit();
      bus.emit('extraOffer', o);
    } else finish();
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
    view.extrasDrawn = 0;
    view.summary = null;
    view.phase = 'drawing';
    (view as unknown as { _order: number[] })._order = shuffle(Array.from({ length: 90 }, (_, i) => i + 1), rng);
    emit();
    bus.emit('roundStart', { bet: view.bet, totalBet: view.totalBet });
    timer = window.setTimeout(() => nextBall(false), 400);
  },
  buyExtra() {
    if (!view.extraOffer?.free) view.credits -= view.extraOffer?.cost ?? 0;
    view.extraOffer = null;
    view.phase = 'extraDrawing';
    emit();
    nextBall(true);
  },
  finishExtra() {
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
  changeBet(dir) {
    const i = Math.max(0, Math.min(BET_OPTIONS.length - 1, BET_OPTIONS.indexOf(view.bet) + dir));
    view.bet = BET_OPTIONS[i];
    emit();
  },
  changeCards(dir) {
    view.cardCount = Math.max(1, Math.min(4, view.cardCount + dir));
    emit();
  },
  shuffleCards() {
    view.cards = generateCards(rng);
    view.drawn = [];
    view.current = null;
    view.mainCount = 0;
    view.extrasDrawn = 0;
    emit();
  },
  setTurbo(on) {
    view.turbo = on;
    view.settings = { ...view.settings, turbo: on };
    emit();
    bus.emit('turboChanged', { on });
  },
  openMail() {
    if (view.mail) view.mail = { ...view.mail, open: true };
    emit();
  },
  claimMail() {
    if (view.mail) view.credits += view.mail.amount;
    view.mail = null;
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
    unlock: (pin) => pin === adminPin,
    lock: () => {},
    stats: () => ({
      creditos: view.credits,
      acumulado: view.jackpot,
      bingosNoMes: 2,
      ultimosBingos: ['15/10/2026', '02/10/2026', '19/09/2026', '04/09/2026', '21/08/2026', '08/08/2026', '25/07/2026', '12/07/2026'],
      diasDesdeUltimoBingo: 5,
      rodadas: q.get('big') ? 1234567 : 342,
      rodadasPorDia: 14.3,
      premiosPorTipo: { linha: 120, cantos: 31, piramide: 12, u: 9, linhaDupla: 41, moldura: 3, bingo: 8 },
      rtpComum: 0.884,
      rtpTotal: 0.931,
      recargas: 3,
      tuning: { ...tuning },
    }),
    device: () => ({
      userAgent: q.get('ua') ?? 'Mozilla/5.0 (Linux; Android 6.0.1; SM-T285 Build/MMB29M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/72.0.3626.121 Safari/537.36',
      chromeVersion: '72.0.3626.121',
      deviceMemory: 1,
      cores: 4,
      screen: `${screen.width}x${screen.height} @${devicePixelRatio}`,
      viewport: `${innerWidth}x${innerHeight}`,
      dpr: devicePixelRatio,
      fpsMedio: 47.3,
      piorQuadroMs: 83,
      memoriaJsMB: 38,
      modoEconomico: true,
      sw: 'v3',
    }),
    getTuning: () => ({ ...tuning }),
    setTuning: (p) => {
      tuning = { ...tuning, ...p };
      if (p.conjuntoPadroes) setName = p.conjuntoPadroes;
      emit();
    },
    resetTuning: () => {
      tuning = { ...DEFAULT_TUNING };
      setName = tuning.conjuntoPadroes;
      emit();
    },
    changePin: (o, n) => {
      if (o !== adminPin || !/^\d{4}$/.test(n)) return false;
      adminPin = n;
      return true;
    },
    resetPin: (d) => d === '1958' && ((adminPin = '1958'), true),
    exportJson: () => JSON.stringify({ version: 3, credits: view.credits, tuning, adminPin }),
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
    setPatternSet: (n) => {
      setName = n;
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
  const c: Card[] = view.cards;
  const n = (ci: number, ks: number[]) => ks.map((k) => c[ci].nums[k]);
  const onCards = new Set(c.flatMap((k) => k.nums));
  const filler = shuffle(Array.from({ length: 90 }, (_, i) => i + 1).filter((x) => !onCards.has(x)), seededRng(5));
  /** `size` bolas: as marcadas + enchimento fora das cartelas, em ordem embaralhada */
  const build = (marked: number[], size: number): number[] => {
    const set = new Set(marked);
    for (const f of filler) {
      if (set.size >= size) break;
      set.add(f);
    }
    return shuffle([...set], seededRng(3)).slice(0, size);
  };
  const near = [
    ...n(0, [0, 1, 2, 3, 4, 5, 6, 7, 8]), // linha 0 + 4 da linha 1 => linha dupla falta 1
    ...n(1, [0, 4, 10, 7]),
    ...n(2, [0, 3, 6, 9, 12]),
    ...n(3, [1, 2, 11]),
  ];
  const setPlaying = (drawn: number[], mainCount: number, extras: number) => {
    view.drawn = drawn;
    view.current = drawn[drawn.length - 1] ?? null;
    view.mainCount = mainCount;
    view.extrasDrawn = extras;
    view.credits = view.credits === 1250 ? 1230 : view.credits;
  };

  if (name === 'splash') view.phase = 'splash';
  if (name === 'drawing') {
    setPlaying(build(near.slice(0, 11), 17), 17, 0);
    view.phase = 'drawing';
    view.cardCount = 3;
  }
  if (name === 'drawing-turbo') {
    setPlaying(build(near, 24), 24, 0);
    view.phase = 'drawing';
    view.turbo = true;
  }
  if (name === 'extra' || name === 'extra-free') {
    const all = build(near, 32);
    setPlaying(all, 30, 2);
    view.phase = 'extraOffer';
    view.extraOffer = { cost: 8, free: name === 'extra-free', remaining: 7, improves: [{ cardIndex: 0, pattern: 'linhaDupla', gain: view.bet * MULTIPLIER.linhaDupla }] };
  }
  if (name === 'mail-arrived' || name === 'mail-open') {
    view.phase = 'idle';
    view.mail = { kind: 'daily', amount: 300, open: name === 'mail-open' };
  }
  if (name === 'line' || name === 'line-cards') {
    setPlaying(build(near, 30), 30, 0);
    view.summary = { bet: 5, totalBet: 20, results: [], prize: 25, jackpot: 0, extrasUsed: 0, extraCost: 0, freeExtras: 0, best: 'linha' };
    view.phase = name === 'line' ? 'celebrating' : 'idle';
  }
  if (name === 'bingo' || name === 'bingo-cards') {
    const full = [...c[0].nums, ...n(1, [0, 1, 2, 3, 4])];
    setPlaying(build(full, 26), 26, 0);
    view.summary = { bet: 5, totalBet: 20, results: [], prize: 2500 + 5432, jackpot: 5432, extrasUsed: 0, extraCost: 0, freeExtras: 0, best: 'bingo' };
    view.phase = name === 'bingo' ? 'celebrating' : 'idle';
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
  if (name === 'line-cards') {
    bus.emit('patternWon', { cardIndex: 1, pattern: 'linha', prize: 25, ball: view.current ?? 1 });
    bus.emit('patternWon', { cardIndex: 0, pattern: 'linha', prize: 25, ball: view.current ?? 1 });
  }
  if (name === 'bingo-cards') bus.emit('patternWon', { cardIndex: 0, pattern: 'bingo', prize: 2500, ball: view.current ?? 1 });
  if (name === 'idle' || name === 'drawing' || name === 'extra') setSpokenCaption('');
  if (name === 'spoken') setSpokenCaption('Bola vinte e três! Vinte e três!');
  if (name === 'prizes') document.querySelector<HTMLElement>('.ptab')!.click();
  if (name.startsWith('settings')) {
    document.querySelector<HTMLElement>('.top .gear')!.click();
    const tab = name.split('-')[1];
    if (tab) [...document.querySelectorAll<HTMLElement>('.tabs .tab')].find((b) => b.textContent!.toLowerCase() === tab)?.click();
  }
  if (name === 'pin' || name.startsWith('admin')) {
    for (let i = 0; i < 5; i++) document.querySelector<HTMLElement>('.top .logo')!.click();
    const press = (root: string, keys: string) => {
      for (const k of keys) [...document.querySelectorAll<HTMLElement>(`${root} .keys .btn`)].find((b) => b.textContent === k)!.click();
    };
    const m = /^admin(?:-(resumo|jogo|pin|aparelho))?(?:-(\d))?$/.exec(name);
    if (m) {
      press('.pindlg', '1958');
      const tab = m[1] ?? 'resumo';
      document.querySelector<HTMLElement>(`.adm .tab[data-tab="${tab}"]`)!.click();
      const n = Number(m[2] ?? 1);
      if (tab === 'pin') {
        if (n >= 2) press('.adm', '1958');
        if (n >= 3) press('.adm', '4321');
      } else for (let i = 1; i < n; i++) document.querySelectorAll<HTMLElement>(`.adm .p-${tab} .pgb`)[1]?.click();
    }
  }
  if (name === 'settings-admin') {
    document.querySelector<HTMLElement>('.top .gear')!.click();
    [...document.querySelectorAll<HTMLElement>('.tabs .tab')].find((b) => b.textContent!.toLowerCase() === 'tela')?.click();
    document.querySelector<HTMLElement>('.arow .btn')!.click();
  }
}
(window as unknown as { __dev: unknown }).__dev = { scenario, api, view, setSpokenCaption };
const s = q.get('s');
if (s) scenario(s);
else emit();
