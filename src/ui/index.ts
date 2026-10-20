// UI vanilla DOM: renderiza GameView e chama GameApi. Nao contem regras de jogo.
import '../styles/tokens.css';
import '../styles/layout.css';
import '../styles/components.css';
import type { GameApi, GameView } from '../gameApi';
import { bus } from '../events';
import { T } from '../texts';
import { BALLS_MAIN } from '../types';
import { btn, fmt, h, setCls, setText } from './dom';
import { createCaptions } from './captions';
import { createCards } from './cardView';
import { createBalls } from './ballView';
import { createControls, makeLogo } from './controls';
import { createModals } from './modals';
import { createPrizeTable } from './prizeView';
import { createExtraPanel } from './extraPanel';
import { U } from './uitext';

export { setSpokenCaption } from './captions';

export interface UIHandle {
  render(): void;
  destroy(): void;
}

/** Chrome/WebView antigo (< 84) ignora `gap` em flex: o CSS usa margens quando a raiz tem `.nogap`. */
function flexGapSupported(): boolean {
  try {
    const f = document.createElement('div');
    f.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    const a = document.createElement('div');
    a.style.height = '1px';
    f.append(a, a.cloneNode());
    document.body.appendChild(f);
    const ok = f.scrollHeight === 3;
    f.remove();
    return ok;
  } catch {
    return true;
  }
}

export function mountUI(root: HTMLElement, api: GameApi): UIHandle {
  root.classList.add('altina');
  if (!flexGapSupported()) root.classList.add('nogap');
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
  const cards = createCards();
  const balls = createBalls();
  const prizes = createPrizeTable(() => modals.open('prizes'));
  const xpanel = createExtraPanel(api);
  const controls = createControls({
    play: () => api.play(),
    numbers: () => {
      api.shuffleCards();
      controls.shuffleAnim();
      if (!isLight()) cards.shuffle();
    },
    turbo: (on) => api.setTurbo(on),
    settings: () => modals.open('settings'),
    sound: () => api.updateSettings({ muted: !lastView?.settings.muted }),
    bet: (d) => api.changeBet(d),
    cards: (d) => api.changeCards(d),
    mail: () => api.openMail(),
    logoTap,
  });

  const modals = createModals(api, () => render());

  // legenda: no celular fica numa faixa propria (ao lado de som/ajustes); no tablet, junto da bola
  const capSlot = h('div', 'capslot');
  balls.capHost.append(captions.el);
  const phoneMq = window.matchMedia('(orientation: portrait) and (max-width: 599px)');
  const placeCaption = () => (phoneMq.matches ? capSlot : balls.capHost).append(captions.el);
  phoneMq.addEventListener?.('change', placeCaption);
  placeCaption();

  // ---- splash ----
  const splash = h('div', 'splash');
  const sLogo = makeLogo(logoTap);
  const greet = h('div', 'greet', T.greet(new Date().getHours()));
  const enter = btn('green', T.enter, () => api.enter());
  splash.append(sLogo, greet, enter);

  root.append(
    controls.top,
    capSlot,
    balls.ballsec,
    xpanel.el,
    balls.strip,
    balls.trail,
    prizes.el,
    cards.el,
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

  /** Texto de estado padrao da legenda (quando nao ha fala nem aviso visual). */
  function stateText(v: GameView): string {
    switch (v.phase) {
      case 'idle':
        return v.summary && v.drawn.length > 0 ? (v.summary.prize > 0 ? U.stateWon(v.summary.prize) : U.stateDone) : U.stateIdle;
      case 'drawing':
      case 'extraDrawing':
        return U.stateDrawing;
      case 'extraOffer':
        return U.stateExtra;
      case 'settling':
        return U.stateSettling;
      default:
        return '';
    }
  }

  function counterText(v: GameView): string {
    if (v.extrasDrawn > 0) return U.extraOf(v.extrasDrawn, v.extraTotal);
    return U.ballOf(Math.min(v.mainCount, BALLS_MAIN), BALLS_MAIN);
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
    captions.setState(stateText(v));

    const inGame = v.phase !== 'splash';
    setCls(splash, 'hide', inGame);
    modals.sync(v, { giftKind, light: s.light });

    const offerOn = xpanel.update(v);
    setCls(root, 'x-on', offerOn);
    setCls(root, 'has-mail', !!v.mail && !v.mail.open && v.phase === 'idle');

    const drawing = v.phase === 'drawing' || v.phase === 'extraDrawing' || v.phase === 'extraOffer';
    cards.update({
      cards: v.cards,
      active: v.active,
      drawn: v.drawn,
      showAlmost: drawing || v.phase === 'settling' || v.phase === 'celebrating',
      prizeTable: v.prizeTable,
      offer: v.phase === 'extraOffer' ? v.extraOffer : null,
    });
    balls.update({ drawn: v.drawn, current: v.current, counter: counterText(v) });
    prizes.update(v);
    controls.update(v);

    if (v.credits !== lastCredits) {
      showCredits(v.credits);
      lastCredits = v.credits;
    }
  }

  // ------------------------------------------------ eventos pontuais
  // A legenda NAO e derivada destes eventos: ela mostra a fala que tocou (setSpokenCaption).
  const on = bus.on.bind(bus);
  unsubs.push(
    on('roundStart', () => {
      cards.resetWon();
      setText(liveBall, '');
    }),
    on('ballDrawn', ({ ball }) => {
      if (!isLight()) balls.pop();
      setText(liveBall, T.ballCaption(ball));
    }),
    on('almost', ({ cardIndex }) => {
      if (!isLight()) cards.flash(cardIndex);
      captions.flash(T.almost, 2200); // aviso visual, nao falado
      setText(livePrize, `${U.card(cardIndex + 1)}: ${U.almostOne}`);
    }),
    on('patternWon', ({ cardIndex, pattern, prize }) => {
      cards.setWon(cardIndex, pattern, prize);
      render();
      if (!isLight()) cards.popSeal(cardIndex);
      prizes.flash(pattern);
      setText(livePrize, `${U.card(cardIndex + 1)}: ${T.patternNames[pattern]}, ${prize} créditos`);
    }),
    on('roundEnd', ({ summary, won }) => {
      setText(livePrize, won ? U.wonPrize(summary.prize) : T.nextTime);
    }),
    on('bingo', () => {
      setText(livePrize, `${T.bingoBig} ${T.congrats}`);
    }),
    on('jackpot', ({ amount }) => {
      prizes.flash('jackpot');
      setText(livePrize, `${T.jackpotWon} ${fmt(amount)}`);
    }),
    on('giftCredits', () => {
      giftKind = 'gift';
    }),
    on('dailyBonus', () => {
      giftKind = 'daily';
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
      phoneMq.removeEventListener?.('change', placeCaption);
      root.textContent = '';
      root.classList.remove('altina', 'nogap', 'light', 'x-on', 'has-mail', 'ts-normal', 'ts-grande', 'ts-muito');
    },
  };
}
