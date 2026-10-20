// Cartelas: DOM construido uma vez; marcar = troca de classe via Map<numero, celulas[]>.
import type { Card } from '../types';
import { markedMask } from '../cards';
import { bestPattern, bestReachableByOne, missingCells } from '../patterns';
import { T } from '../texts';
import { h, setAttr, setCls, setText, cloverSvg } from './dom';
import { U } from './uitext';

interface CardUi {
  el: HTMLElement;
  cells: HTMLElement[];
  seal: HTMLElement;
  sealTxt: HTMLElement;
  falta: HTMLElement;
  sig: string;
  mask: number;
  active: boolean;
  miss: number; // mascara das celulas "falta 1" mostradas
  sealPat: string;
}

export interface CardsView {
  el: HTMLElement;
  update(args: {
    cards: Card[];
    active: boolean[];
    drawn: number[];
    interactive: boolean;
    showAlmost: boolean;
  }): void;
  flash(i: number): void;
  popSeal(i: number): void;
}

export function createCards(onToggle: (i: number) => void): CardsView {
  const root = h('div', 'cards', undefined, { role: 'group', 'aria-label': 'Cartelas' });
  const ui: CardUi[] = [];
  /** numero -> celulas de TODAS as cartelas (uma entrada por cartela) */
  const byNum = new Map<number, { cell: HTMLElement; card: number }[]>();
  let shown = 0; // bolas ja aplicadas incrementalmente
  let lastNew: HTMLElement[] = [];

  for (let i = 0; i < 4; i++) {
    const el = h('div', `card k${i + 1}`, undefined, { role: 'button', tabindex: '0', 'aria-pressed': 'true' });
    const head = h('div', 'card-head');
    const num = h('span', 'card-num', String(i + 1));
    const seal = h('span', 'seal');
    seal.insertAdjacentHTML('beforeend', cloverSvg());
    const sealTxt = h('span');
    seal.append(sealTxt);
    const falta = h('span', 'falta', T.almost);
    const offtag = h('span', 'offtag', U.off);
    head.append(num, seal, falta, offtag);
    const grid = h('div', 'grid');
    const cells: HTMLElement[] = [];
    for (let k = 0; k < 15; k++) {
      const c = h('span', 'cell');
      cells.push(c);
      grid.append(c);
    }
    el.append(head, grid);
    root.append(el);
    let lastTap = -1e9;
    const fire = () => {
      if (el.classList.contains('lock')) return;
      const now = performance.now();
      if (now - lastTap < 250) return;
      lastTap = now;
      onToggle(i);
    };
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        fire();
      }
    });
    ui.push({ el, cells, seal, sealTxt, falta, sig: '', mask: 0, active: true, miss: 0, sealPat: '' });
  }

  function rebuildCard(i: number, card: Card): void {
    const u = ui[i];
    // remove entradas antigas do mapa
    byNum.forEach((arr, k) => {
      const f = arr.filter((e) => e.card !== i);
      if (f.length) byNum.set(k, f);
      else byNum.delete(k);
    });
    card.nums.forEach((n, k) => {
      setText(u.cells[k], String(n));
      u.cells[k].className = 'cell';
      let arr = byNum.get(n);
      if (!arr) byNum.set(n, (arr = []));
      arr.push({ cell: u.cells[k], card: i });
    });
    u.mask = 0;
    u.miss = 0;
    u.sig = card.nums.join(',');
  }

  function setMark(u: CardUi, k: number, on: boolean, fresh: boolean): void {
    const c = u.cells[k];
    if (on) {
      c.classList.add('mk');
      if (fresh) {
        c.classList.add('nw');
        lastNew.push(c);
      }
    } else c.classList.remove('mk', 'nw');
  }

  return {
    el: root,
    update({ cards, active, drawn, interactive, showAlmost }) {
      let full = drawn.length < shown;
      cards.forEach((card, i) => {
        if (ui[i].sig !== card.nums.join(',')) {
          rebuildCard(i, card);
          full = true;
        }
        if (ui[i].active !== active[i]) full = true;
      });
      const drawnSet = new Set(drawn);

      // limpa carimbos "novos" da bola anterior
      if (lastNew.length) {
        for (const c of lastNew) c.classList.remove('nw');
        lastNew = [];
      }

      if (full) {
        cards.forEach((card, i) => {
          const u = ui[i];
          const want = active[i] ? markedMask(card, drawnSet) : 0;
          for (let k = 0; k < 15; k++) setMark(u, k, (want >> k) & 1 ? true : false, false);
          u.mask = want;
        });
        shown = drawn.length;
      } else if (drawn.length > shown) {
        // caminho incremental: so as bolas novas, via Map
        for (let b = shown; b < drawn.length; b++) {
          const list = byNum.get(drawn[b]);
          if (!list) continue;
          for (const { cell, card } of list) {
            if (!active[card]) continue;
            cell.classList.add('mk', 'nw');
            lastNew.push(cell);
            const k = ui[card].cells.indexOf(cell);
            ui[card].mask |= 1 << k;
          }
        }
        shown = drawn.length;
      }

      cards.forEach((_, i) => {
        const u = ui[i];
        u.active = active[i];
        const on = active[i];
        setCls(u.el, 'off', !on);
        setCls(u.el, 'lock', !interactive);
        setAttr(u.el, 'aria-pressed', on ? 'true' : 'false');
        setAttr(u.el, 'aria-label', `${U.card(i + 1)}${on ? '' : ', ' + U.off}`);
        u.el.style.cursor = interactive ? 'pointer' : 'default';

        const best = on ? bestPattern(u.mask) : null;
        const sealKey = best ?? '';
        if (u.sealPat !== sealKey) {
          u.sealPat = sealKey;
          if (best) setText(u.sealTxt, T.patternNames[best]);
          setCls(u.seal, 'on', !!best);
        }

        // FALTA 1!
        let missMask = 0;
        if (on && showAlmost) {
          const nxt = bestReachableByOne(u.mask);
          if (nxt) for (const k of missingCells(u.mask, nxt)) missMask |= 1 << k;
        }
        if (missMask !== u.miss) {
          const diff = missMask ^ u.miss;
          for (let k = 0; k < 15; k++) if ((diff >> k) & 1) setCls(u.cells[k], 'miss', ((missMask >> k) & 1) === 1);
          u.miss = missMask;
          setCls(u.falta, 'on', missMask !== 0);
          setCls(u.el, 'has-falta', missMask !== 0);
        }
      });
    },
    flash(i) {
      const el = ui[i]?.el;
      if (!el) return;
      el.classList.remove('flash');
      // reinicia animacao sem forcar layout: usa Web Animations quando existe
      if (el.animate) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }, { transform: 'scale(1)' }], { duration: 450 });
      else el.classList.add('flash');
    },
    popSeal(i) {
      const el = ui[i]?.seal;
      if (el?.animate)
        el.animate([{ transform: 'scale(.3)', opacity: 0.2 }, { transform: 'scale(1.25)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 420 });
    },
  };
}
