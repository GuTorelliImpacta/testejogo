// Barra superior (logo, saldo, acumulado, som, ajustes) e barra de controles (aposta, JOGAR, extras).
import type { GameView } from '../gameApi';
import { T, } from '../texts';
import { btn, cloverSvg, fmt, h, ICONS, press, setAttr, setText, setCls } from './dom';
import { U } from './uitext';

export interface Handlers {
  play(): void;
  accelerate(): void;
  swap(): void;
  prizes(): void;
  settings(): void;
  sound(): void;
  auto(): void;
  bet(dir: 1 | -1): void;
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
  update(v: GameView, canAct: boolean): void;
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
  let soundMuted: boolean | null = null;
  const sound = h('button', 'btn icon', undefined, { type: 'button' });
  press(sound, hd.sound, 200);
  const gear = h('button', 'btn icon', undefined, { type: 'button', 'aria-label': T.settings });
  gear.innerHTML = ICONS.gear;
  press(gear, hd.settings, 300);
  top.append(logo, h('span', 'sp'), cred, jack, sound, gear);

  // ---- barra ----
  const bar = h('div', 'bar');
  const minus = btn('sq', '−', () => hd.bet(-1), 120);
  minus.setAttribute('aria-label', 'Diminuir aposta');
  const plus = btn('sq', '+', () => hd.bet(1), 120);
  plus.setAttribute('aria-label', 'Aumentar aposta');
  const betbox = h('div', 'betbox', undefined, { 'aria-live': 'polite' });
  const l1 = h('span', 'l1');
  const l2 = h('span', 'l2');
  betbox.append(l1, l2);
  const betG = h('div', 'bet-g');
  betG.append(minus, betbox, plus);

  const play = btn('play', T.play, hd.play);
  play.classList.add('play');
  const swap = btn('sec s1', '', hd.swap);
  swap.innerHTML = ICONS.swap;
  swap.append(h('span', 'lg', T.swapCards), h('span', 'sh', U.swapShort));
  const prizes = btn('sec s2', '', hd.prizes, 300);
  prizes.innerHTML = ICONS.trophy;
  prizes.append(h('span', '', T.prizes));
  const fast = btn('sec s3', '', hd.accelerate);
  fast.innerHTML = ICONS.fast;
  fast.append(h('span', 'lg', T.accelerate), h('span', 'sh', U.fastShort));
  const auto = btn('sec s4', '', hd.auto);
  auto.innerHTML = ICONS.auto;
  const autoT = h('span', 'lg', T.auto);
  const autoS = h('span', 'sh', U.autoShort);
  auto.append(autoT, autoS);
  bar.append(betG, play, swap, prizes, fast, auto);
  betG.classList.add('bet-g');

  return {
    top,
    bar,
    creditsVal,
    update(v, canAct) {
      setText(jackVal, fmt(v.jackpot));
      const muted = v.settings.muted;
      if (soundMuted !== muted) {
        soundMuted = muted;
        sound.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
      }
      setAttr(sound, 'aria-label', muted ? U.soundOff : U.soundOn);
      setAttr(sound, 'aria-pressed', muted ? 'true' : 'false');
      setCls(sound, 'sel', muted);

      setText(l1, `${U.perCard} ${v.bet}`);
      setText(l2, `${T.totalBet} ${fmt(v.totalBet)}`);
      const idle = v.phase === 'idle' && canAct;
      const drawing = v.phase === 'drawing' || v.phase === 'extraDrawing';
      play.disabled = !idle;
      swap.disabled = !idle;
      minus.disabled = !idle;
      plus.disabled = !idle;
      fast.disabled = !drawing;
      setText(autoT, v.auto ? U.autoOn : T.auto);
      setText(autoS, v.auto ? U.autoShortOn : U.autoShort);
      setAttr(auto, 'aria-pressed', v.auto ? 'true' : 'false');
    },
  };
}
