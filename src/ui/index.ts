// UI vanilla DOM: renderiza GameView e chama GameApi. Nao contem regras de jogo.
import '../styles/tokens.css';
import '../styles/layout.css';
import '../styles/components.css';
import type { GameApi, GameView } from '../gameApi';
import { bus } from '../events';
import { T, } from '../texts';
import { PLAYER } from '../config';
import { btn, fmt, h, setCls, setText } from './dom';
import { createCaptions } from './captions';
import { createCards } from './cardView';
import { createBalls } from './ballView';
import { createControls, makeLogo } from './controls';
import { createModals } from './modals';
import { U } from './uitext';

export interface UIHandle {
  render(): void;
  destroy(): void;
}

export function mountUI(root: HTMLElement, api: GameApi): UIHandle {
  root.classList.add('altina');
  root.textContent = '';
  const unsubs: (() => void)[] = [];

  // ---- regioes vivas para leitores de tela ----
  const liveBall = h('div', 'sr', '', { 'aria-live': 'polite', role: 'status' });
  const livePrize = h('div', 'sr', '', { 'aria-live': 'assertive', role: 'alert' });

  // ---- logo secreto: 5 toques seguidos abrem o PIN ----
  const taps: number[] = [];
  const logoTap = () => {
    const now = performance.now();
    taps.push(now);
    while (taps.length && now - taps[0] > 3000) taps.shift();
    if (taps.length >= 5) {
      taps.length = 0;
      modals.open('pin');
    }
  };

  const captions = createCaptions();
  const cap = h('div', 'cap');
  cap.append(captions.el);

  const cards = createCards((i) => {
    if (lastView?.phase === 'idle') api.toggleCard(i);
  });
  const balls = createBalls();
  const controls = createControls({
    play: () => api.play(),
    accelerate: () => api.accelerate(),
    swap: () => api.swapCards(),
    prizes: () => modals.open('prizes'),
    settings: () => modals.open('settings'),
    sound: () => api.updateSettings({ muted: !lastView?.settings.muted }),
    auto: () => api.setAuto(!lastView?.auto),
    bet: (d) => api.changeBet(d),
    logoTap,
  });

  const modals = createModals(api, () => render());

  // ---- splash ----
  const splash = h('div', 'splash');
  const sLogo = makeLogo(logoTap);
  const greet = h('div', 'greet', T.greet(new Date().getHours()));
  const enter = btn('green', T.enter, () => api.enter());
  splash.append(sLogo, greet, enter);

  root.append(
    controls.top,
    cap,
    cards.el,
    balls.ballbox,
    balls.hist,
    balls.recent,
    controls.bar,
    liveBall,
    livePrize,
    ...modals.layers,
    splash,
  );

  // ------------------------------------------------ estado local
  let lastView: GameView | null = null;
  let giftKind: 'gift' | 'daily' = 'gift';
  let lastTextSize = '';
  let lastCredits = -1;
  let creditShown = 0;
  let creditRaf = 0;
  let lastPhase = '';

  const isLight = () => root.classList.contains('light');

  function showCredits(target: number): void {
    cancelAnimationFrame(creditRaf);
    if (lastCredits < 0 || target <= creditShown) {
      creditShown = target;
      setText(controls.creditsVal, fmt(target));
      return;
    }
    const from = creditShown;
    const t0 = performance.now();
    controls.creditsVal.classList.add('up');
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1200);
      creditShown = from + (target - from) * (1 - Math.pow(1 - k, 3));
      setText(controls.creditsVal, fmt(creditShown));
      if (k < 1) creditRaf = requestAnimationFrame(step);
      else {
        creditShown = target;
        controls.creditsVal.classList.remove('up');
      }
    };
    creditRaf = requestAnimationFrame(step);
  }

  function render(): void {
    const v = api.getView();
    lastView = v;
    const s = v.settings;

    // classes do root: modo leve e tamanho do texto
    setCls(root, 'light', s.light);
    const ts = `ts-${s.textSize === 'normal' ? 'normal' : s.textSize}`;
    if (ts !== lastTextSize) {
      root.classList.remove('ts-normal', 'ts-grande', 'ts-muito');
      root.classList.add(ts);
      lastTextSize = ts;
    }
    captions.setEnabled(s.captions);

    const inGame = v.phase !== 'splash';
    setCls(splash, 'hide', inGame);
    modals.sync(v, { giftKind, light: s.light });

    const drawing = v.phase === 'drawing' || v.phase === 'extraDrawing' || v.phase === 'extraOffer';
    cards.update({
      cards: v.cards,
      active: v.active,
      drawn: v.drawn,
      interactive: v.phase === 'idle',
      showAlmost: drawing || v.phase === 'settling' || v.phase === 'celebrating',
    });
    balls.update(v.drawn, v.current, v.mainCount);
    controls.update(v, true);

    if (v.credits !== lastCredits) {
      showCredits(v.credits);
      lastCredits = v.credits;
    }
    lastPhase = v.phase;
  }

  // ------------------------------------------------ eventos pontuais
  const on = bus.on.bind(bus);
  unsubs.push(
    on('roundStart', () => {
      captions.show(T.luck, 2, 1800);
      setText(liveBall, '');
    }),
    on('ballDrawn', ({ ball, extra, fast }) => {
      if (!isLight()) balls.pop();
      if (!fast) captions.show(extra ? `${U.extraRound} ${T.ballCaption(ball)}` : T.ballCaption(ball), 1, 1600);
      setText(liveBall, `${T.ballCaption(ball)}`);
    }),
    on('almost', ({ cardIndex, forBingo }) => {
      if (!isLight()) cards.flash(cardIndex);
      const t = forBingo ? U.almostBingo : U.almostOne;
      captions.show(t, 3, 2200);
      setText(livePrize, `${U.card(cardIndex + 1)}: ${t}`);
    }),
    on('patternWon', ({ cardIndex, pattern, prize }) => {
      if (!isLight()) cards.popSeal(cardIndex);
      captions.show(`${T.patternShout[pattern]}`, 4, 2400);
      setText(livePrize, `${U.card(cardIndex + 1)}: ${T.patternNames[pattern]}, ${prize} créditos`);
    }),
    on('extraOffer', () => captions.show(T.extraOffer, 3, 3000)),
    on('extraBought', () => captions.show(U.extraBought, 3, 2000)),
    on('roundEnd', ({ summary, won }) => {
      const t = won ? `${T.won} +${fmt(summary.prize)}` : T.nextTime;
      captions.show(t, 2, 3000);
      setText(livePrize, won ? U.wonPrize(summary.prize) : T.nextTime);
    }),
    on('bingo', () => {
      captions.show(`${T.bingoBig} ${T.congrats}`, 5, 4000);
      setText(livePrize, `${T.bingoBig} ${T.congrats}`);
    }),
    on('jackpot', ({ amount }) => {
      captions.show(T.jackpotWon, 5, 4000);
      setText(livePrize, `${T.jackpotWon} ${fmt(amount)}`);
    }),
    on('giftCredits', () => {
      giftKind = 'gift';
      captions.show(T.giftTitle, 3, 3000);
    }),
    on('dailyBonus', () => {
      giftKind = 'daily';
      captions.show(T.dailyTitle, 3, 3000);
    }),
  );

  render();

  return {
    render,
    destroy() {
      unsubs.forEach((f) => f());
      cancelAnimationFrame(creditRaf);
      captions.destroy();
      modals.destroy();
      root.textContent = '';
      root.classList.remove('altina', 'light', 'ts-normal', 'ts-grande', 'ts-muito');
      void lastPhase;
      void PLAYER;
    },
  };
}
