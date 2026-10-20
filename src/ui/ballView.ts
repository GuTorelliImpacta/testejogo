// Bola atual, historico 1-60 e ultimas 5 bolas (celular).
import { h, setCls, setText, range } from './dom';

function ballEl(extraCls = ''): { el: HTMLElement; num: HTMLElement } {
  const el = h('div', 'ball empty ' + extraCls);
  const num = h('b', '', '');
  el.append(num);
  return { el, num };
}

function paint(el: HTMLElement, n: number | null, extra: boolean): void {
  const r = n ? `r${range(n)}` : '';
  const key = `${r}|${extra}`;
  const e = el as HTMLElement & { _k?: string };
  if (e._k === key) return;
  e._k = key;
  el.classList.remove('r1', 'r2', 'r3', 'r4', 'r5');
  if (r) el.classList.add(r);
  setCls(el, 'empty', !n);
  setCls(el, 'xtra', extra);
}

export interface BallViews {
  ballbox: HTMLElement;
  hist: HTMLElement;
  recent: HTMLElement;
  update(drawn: number[], current: number | null, mainCount: number): void;
  pop(): void;
}

export function createBalls(): BallViews {
  const ballbox = h('div', 'ballbox', undefined, { 'aria-hidden': 'true' });
  const big = ballEl('shine');
  ballbox.append(big.el);

  const hist = h('div', 'hist', undefined, { 'aria-hidden': 'true' });
  const cells: HTMLElement[] = [];
  for (let n = 1; n <= 60; n++) {
    const c = h('i', `r${range(n)}`, String(n));
    cells.push(c);
    hist.append(c);
  }

  const recent = h('div', 'recent', undefined, { 'aria-hidden': 'true' });
  const rb = Array.from({ length: 6 }, () => ballEl());
  rb.forEach((b, i) => {
    recent.append(b.el);
    if (i === 0) recent.append(h('span', 'sep'));
  });

  let shown = 0;
  let lastEl: HTMLElement | null = null;
  let lastRecentKey = '';

  return {
    ballbox,
    hist,
    recent,
    update(drawn, current, mainCount) {
      if (drawn.length < shown) {
        for (const c of cells) c.classList.remove('on', 'x', 'last');
        shown = 0;
        lastEl = null;
      }
      if (drawn.length > shown) {
        for (let i = shown; i < drawn.length; i++) {
          const c = cells[drawn[i] - 1];
          c.classList.add('on');
          if (i >= mainCount) c.classList.add('x');
        }
        shown = drawn.length;
      }
      const want = current ? cells[current - 1] : null;
      if (want !== lastEl) {
        lastEl?.classList.remove('last');
        want?.classList.add('last');
        lastEl = want;
      }
      // bola grande
      paint(big.el, current, !!current && drawn.length > mainCount);
      setText(big.num, current ? String(current) : '');

      // recentes (celular): atual + 5 anteriores
      const key = drawn.slice(-6).join(',') + '|' + mainCount;
      if (key !== lastRecentKey) {
        lastRecentKey = key;
        const last = drawn.slice(-6).reverse();
        rb.forEach((b, i) => {
          const n = last[i] ?? null;
          paint(b.el, n, false);
          setText(b.num, n ? String(n) : '');
        });
      }
    },
    pop() {
      if (big.el.animate)
        big.el.animate(
          [
            { transform: 'scale(.35) translateY(-30px)', opacity: 0 },
            { transform: 'scale(1.12)', opacity: 1, offset: 0.65 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 380, easing: 'ease-out' },
        );
    },
  };
}
