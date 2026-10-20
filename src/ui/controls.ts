// Barra superior (logo, saldo, acumulado, correio, som, ajustes) e barra inferior (aposta, cartelas, numeros, turbo, JOGAR).
import type { GameView } from '../gameApi';
import { T } from '../texts';
import { BET_OPTIONS } from '../config';
import { btn, cloverSvg, fmt, h, ICONS, press, setAttr, setCls, setText } from './dom';
import { U } from './uitext';

export interface Handlers {
  play(): void;
  numbers(): void;
  turbo(on: boolean): void;
  settings(): void;
  sound(): void;
  bet(dir: 1 | -1): void;
  cards(dir: 1 | -1): void;
  mail(): void;
  logoTap(): void;
}

export function makeLogo(onTap: () => void): HTMLButtonElement {
  const b = h('button', 'logo', undefined, { type: 'button', 'aria-label': T.title });
  b.insertAdjacentHTML('beforeend', cloverSvg());
  const t = h('span', 'lt');
  t.append(h('span', '', T.title.replace('🍀', '')));
  b.append(t);
  b.addEventListener('click', onTap);
  return b;
}

export interface Controls {
  top: HTMLElement;
  bar: HTMLElement;
  creditsVal: HTMLElement;
  update(v: GameView): void;
  shuffleAnim(): void;
}

interface Stepper {
  el: HTMLElement;
  minus: HTMLButtonElement;
  plus: HTMLButtonElement;
  val: HTMLElement;
}

function stepper(cls: string, label: string, dn: string, up: string, onStep: (d: 1 | -1) => void): Stepper {
  const el = h('div', `grp ${cls}`);
  const minus = btn('sq', '−', () => onStep(-1), 120);
  minus.setAttribute('aria-label', dn);
  const plus = btn('sq', '+', () => onStep(1), 120);
  plus.setAttribute('aria-label', up);
  const box = h('div', 'sbox', undefined, { 'aria-live': 'polite' });
  box.append(h('span', 'l1', label));
  const val = h('span', 'l2');
  box.append(val);
  el.append(minus, box, plus);
  return { el, minus, plus, val };
}

export function createControls(hd: Handlers): Controls {
  // ---- topo ----
  const top = h('div', 'top');
  const logo = makeLogo(hd.logoTap);
  const cred = h('div', 'stat cred');
  cred.append(h('span', 'lab', T.credits));
  const creditsVal = h('span', 'val', '0', { 'aria-live': 'off' });
  cred.append(creditsVal);
  const jack = h('div', 'stat jack');
  jack.append(h('span', 'lab', T.jackpot));
  const jackVal = h('span', 'val', '0');
  jack.append(jackVal);

  const mail = h('button', 'mailb hide', undefined, { type: 'button', 'aria-label': U.mailBtn });
  mail.innerHTML = ICONS.mail;
  mail.append(h('span', 'ml', U.mailShort), h('span', 'clv', '🍀'));
  press(mail, hd.mail, 500);

  let soundMuted: boolean | null = null;
  const sound = h('button', 'btn icon snd', undefined, { type: 'button' });
  press(sound, hd.sound, 200);
  const gear = h('button', 'btn icon gear', undefined, { type: 'button', 'aria-label': T.settings });
  gear.innerHTML = ICONS.gear;
  press(gear, hd.settings, 300);
  top.append(logo, h('span', 'sp'), cred, jack, mail, sound, gear);

  // ---- barra ----
  const bar = h('div', 'bar');
  const bet = stepper('g-bet', U.betLab, U.betDown, U.betUp, hd.bet);
  const cards = stepper('g-cards', U.cardsLab, U.cardsDown, U.cardsUp, hd.cards);

  const nums = btn('sec g-nums', '', hd.numbers, 600);
  nums.append(h('span', '', U.numbers));
  const turbo = btn('sec g-turbo', '', () => hd.turbo(!turboOn), 250);
  const tIc = h('span', 'ti');
  tIc.innerHTML = ICONS.turbo;
  const tTx = h('span', 'tt');
  tTx.append(h('span', 'ta', U.turbo));
  const tState = h('span', 'tb', U.turboOff);
  tTx.append(tState);
  turbo.append(tIc, tTx);
  let turboOn = false;

  const play = btn('play g-play', '', hd.play);
  const playT = h('span', 'pt', T.play);
  const playS = h('span', 'ps');
  play.append(playT, playS);
  const rowA = h('div', 'rowa');
  rowA.append(bet.el, cards.el);
  const rowB = h('div', 'rowb');
  rowB.append(nums, turbo, play);
  bar.append(rowA, rowB);

  return {
    top,
    bar,
    creditsVal,
    update(v) {
      setText(jackVal, fmt(v.jackpot));
      const muted = v.settings.muted;
      if (soundMuted !== muted) {
        soundMuted = muted;
        sound.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
      }
      setAttr(sound, 'aria-label', muted ? U.soundOff : U.soundOn);
      setAttr(sound, 'aria-pressed', muted ? 'true' : 'false');
      setCls(sound, 'sel', muted);

      setCls(mail, 'hide', !(v.mail && !v.mail.open && v.phase === 'idle'));

      setText(bet.val, String(v.bet));
      setText(cards.val, String(v.cardCount));
      setText(playS, U.total(v.totalBet));
      const idle = v.phase === 'idle';
      const racing = v.phase === 'drawing' || v.phase === 'extraDrawing' || v.phase === 'extraOffer' || v.phase === 'settling';
      play.disabled = !idle;
      nums.disabled = !idle;
      bet.minus.disabled = !idle || v.bet <= BET_OPTIONS[0];
      bet.plus.disabled = !idle || v.bet >= BET_OPTIONS[BET_OPTIONS.length - 1];
      cards.minus.disabled = !idle || v.cardCount <= 1;
      cards.plus.disabled = !idle || v.cardCount >= 4;
      turboOn = v.turbo;
      turbo.disabled = !(idle || racing);
      setAttr(turbo, 'aria-pressed', v.turbo ? 'true' : 'false');
      setText(tState, v.turbo ? U.turboOn : U.turboOff);
    },
    shuffleAnim() {
      if (nums.animate) nums.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: 250 });
    },
  };
}
