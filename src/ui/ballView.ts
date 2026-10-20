// Bola atual + contador, trilho de 30 bolas (+9 casas de extra) e faixa das ultimas 10 bolas (celular).
import { BALLS_EXTRA_MAX, BALLS_MAIN } from '../types';
import { h, setCls, setText, range } from './dom';

function paintBall(el: HTMLElement, n: number | null, extra: boolean): void {
  const key = `${n ? range(n) : 0}|${extra}`;
  const e = el as HTMLElement & { _k?: string };
  if (e._k === key) return;
  e._k = key;
  el.classList.remove('r1', 'r2', 'r3', 'r4', 'r5');
  if (n) el.classList.add(`r${range(n)}`);
  setCls(el, 'empty', !n);
  setCls(el, 'xtra', extra);
}

export interface BallViews {
  /** Bola grande + contador + lugar da legenda (tablet). */
  ballsec: HTMLElement;
  capHost: HTMLElement;
  /** Trilho: 30 casas em 3 fileiras de 10 + 9 casas de extra. */
  trail: HTMLElement;
  /** Celular: contador + ultimas 10 bolas. */
  strip: HTMLElement;
  update(args: { drawn: number[]; current: number | null; counter: string }): void;
  pop(): void;
}

export function createBalls(): BallViews {
  // ---- bola grande + contador ----
  const ballsec = h('div', 'ballsec');
  const ballbox = h('div', 'ballbox', undefined, { 'aria-hidden': 'true' });
  const big = h('div', 'ball shine empty');
  const bigNum = h('b');
  big.append(bigNum);
  ballbox.append(big);
  const info = h('div', 'binfo');
  const counter = h('div', 'counter', '', { 'aria-hidden': 'true' });
  const capHost = h('div', 'caphost');
  info.append(counter, capHost);
  ballsec.append(ballbox, info);

  // ---- trilho ----
  const trail = h('div', 'trail', undefined, { 'aria-hidden': 'true' });
  const mainRow = h('div', 'tr-main');
  const extraRow = h('div', 'tr-extra');
  const mainCells: HTMLElement[] = [];
  const extraCells: HTMLElement[] = [];
  for (let i = 0; i < BALLS_MAIN; i++) {
    const c = h('i', 'tc');
    mainCells.push(c);
    mainRow.append(c);
  }
  for (let i = 0; i < BALLS_EXTRA_MAX; i++) {
    const c = h('i', 'tc xs');
    extraCells.push(c);
    extraRow.append(c);
  }
  trail.append(mainRow, extraRow);

  // ---- celular: contador + 10 ultimas ----
  const strip = h('div', 'strip', undefined, { 'aria-hidden': 'true' });
  const sCounter = h('div', 'counter');
  const sRow = h('div', 'srow');
  const sCells: HTMLElement[] = [];
  for (let i = 0; i < 10; i++) {
    const c = h('i', 'tc');
    sCells.push(c);
    sRow.append(c);
  }
  strip.append(sCounter, sRow);

  let shown = 0;
  let first = -1;
  let lastCell: HTMLElement | null = null;
  let stripKey = '';

  const fill = (c: HTMLElement, n: number): void => {
    c.className = `tc${c.classList.contains('xs') ? ' xs' : ''} on r${range(n)}`;
    c.textContent = String(n);
  };
  const clear = (c: HTMLElement): void => {
    c.className = c.classList.contains('xs') ? 'tc xs' : 'tc';
    c.textContent = '';
  };

  return {
    ballsec,
    capHost,
    trail,
    strip,
    update({ drawn, current, counter: ct }) {
      if (drawn.length < shown || (drawn.length && drawn[0] !== first)) {
        mainCells.forEach(clear);
        extraCells.forEach(clear);
        shown = 0;
        lastCell = null;
      }
      first = drawn.length ? drawn[0] : -1;
      for (let i = shown; i < drawn.length; i++) {
        const cell = i < BALLS_MAIN ? mainCells[i] : extraCells[i - BALLS_MAIN];
        if (cell) fill(cell, drawn[i]);
      }
      shown = drawn.length;
      const lastIdx = drawn.length - 1;
      const want = lastIdx < 0 ? null : lastIdx < BALLS_MAIN ? mainCells[lastIdx] : extraCells[lastIdx - BALLS_MAIN] ?? null;
      if (want !== lastCell) {
        lastCell?.classList.remove('last');
        want?.classList.add('last');
        lastCell = want;
      }
      paintBall(big, current, drawn.length > BALLS_MAIN);
      setText(bigNum, current ? String(current) : '');
      setText(counter, ct);
      setText(sCounter, ct);

      const key = drawn.slice(-10).join(',');
      if (key !== stripKey) {
        stripKey = key;
        const last = drawn.slice(-10);
        sCells.forEach((c, i) => {
          const n = last[i];
          if (n) fill(c, n);
          else clear(c);
          setCls(c, 'last', i === last.length - 1 && !!n);
        });
      }
    },
    pop() {
      if (big.animate)
        big.animate(
          [
            { transform: 'scale(.35) translateY(-30px)', opacity: 0 },
            { transform: 'scale(1.12)', opacity: 1, offset: 0.65 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 380, easing: 'ease-out' },
        );
      const lc = lastCell;
      if (lc?.animate) lc.animate([{ transform: 'scale(.3)', opacity: 0.3 }, { transform: 'scale(1.25)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }], { duration: 320 });
    },
  };
}
