// Cartelas: DOM construido uma vez; marcar = troca de classe via Map<numero, celulas[]>.
import type { Card, PatternId } from '../types';
import { markedMask } from '../cards';
import { isComplete, levelOf, missing, missingCells } from '../patterns';
import { T } from '../texts';
import { h, setAttr, setCls, setText } from './dom';
import { U } from './uitext';

type Offer = { improves: { cardIndex: number; pattern: PatternId; gain: number }[] } | null;

interface CardUi {
  el: HTMLElement;
  cells: HTMLElement[];
  seal: HTMLElement;
  sealTxt: HTMLElement;
  falta: HTMLElement;
  faltaFull: HTMLElement;
  faltaSh: HTMLElement;
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
    showAlmost: boolean;
    prizeTable: { pattern: PatternId; prize: number }[];
    offer: Offer;
  }): void;
  flash(i: number): void;
  popSeal(i: number): void;
  /** premio efetivamente pago (evento patternWon); ate o proximo reset usa-se a tabela */
  setWon(i: number, pattern: PatternId, prize: number): void;
  resetWon(): void;
  /** animacao curta de embaralhar (so transform/opacity) */
  shuffle(): void;
}

export function createCards(): CardsView {
  const won = new Map<number, { pattern: PatternId; prize: number }>();
  const root = h('div', 'cards', undefined, { role: 'group', 'aria-label': 'Cartelas' });
  const ui: CardUi[] = [];
  /** numero -> celulas de TODAS as cartelas (uma entrada por cartela) */
  const byNum = new Map<number, { cell: HTMLElement; card: number }[]>();
  let shown = 0; // bolas ja aplicadas incrementalmente
  let lastNew: HTMLElement[] = [];

  for (let i = 0; i < 4; i++) {
    const el = h('div', `card k${i + 1}`, undefined, { role: 'group' });
    const head = h('div', 'card-head');
    const num = h('span', 'card-num', String(i + 1));
    const seal = h('div', 'seal');
    const sealTxt = h('span', 'st');
    seal.append(sealTxt);
    const falta = h('span', 'falta');
    const faltaFull = h('span', 'full', T.almost);
    const faltaSh = h('span', 'short', T.almost);
    falta.append(faltaFull, faltaSh);
    const offtag = h('span', 'offtag', U.off);
    head.append(num, falta, offtag);
    const grid = h('div', 'grid');
    const cells: HTMLElement[] = [];
    for (let k = 0; k < 15; k++) {
      const c = h('span', 'cell');
      cells.push(c);
      grid.append(c);
    }
    el.append(head, grid, seal);
    root.append(el);
    ui.push({ el, cells, seal, sealTxt, falta, faltaFull, faltaSh, sig: '', mask: 0, active: true, miss: 0, sealPat: '' });
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
    update({ cards, active, drawn, showAlmost, prizeTable, offer }) {
      const pats = prizeTable.map((p) => p.pattern).sort((a, b) => levelOf(b) - levelOf(a));
      const bestOf = (m: number): PatternId | null => pats.find((p) => isComplete(m, p)) ?? null;
      const reachable = (m: number): PatternId | null => {
        const cur = levelOf(bestOf(m));
        return pats.find((p) => levelOf(p) > cur && missing(m, p) === 1) ?? null;
      };
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
        setAttr(u.el, 'aria-label', `${U.card(i + 1)}${on ? '' : ', ' + U.off}`);

        const best = on ? bestOf(u.mask) : null;
        const w = won.get(i);
        const prize = best ? (w && w.pattern === best ? w.prize : (prizeTable.find((p) => p.pattern === best)?.prize ?? 0)) : 0;
        const sealKey = best ? `${best}|${prize}` : '';
        if (u.sealPat !== sealKey) {
          u.sealPat = sealKey;
          if (best) setText(u.sealTxt, U.sealPrize(T.patternNames[best], prize));
          setCls(u.seal, 'on', !!best);
        }

        // FALTA 1: com oferta de extra mostra o que ganha; fora dela, aviso curto
        const imp = on && offer ? offer.improves.find((x) => x.cardIndex === i) : undefined;
        let target: PatternId | null = null;
        if (on && imp) target = imp.pattern;
        else if (on && showAlmost) target = reachable(u.mask);
        let missMask = 0;
        if (target) for (const k of missingCells(u.mask, target)) missMask |= 1 << k;
        if (missMask !== u.miss) {
          const diff = missMask ^ u.miss;
          for (let k = 0; k < 15; k++) if ((diff >> k) & 1) setCls(u.cells[k], 'miss', ((missMask >> k) & 1) === 1);
          u.miss = missMask;
        }
        setCls(u.falta, 'on', missMask !== 0);
        setCls(u.el, 'has-falta', missMask !== 0);
        if (missMask !== 0) {
          setText(u.faltaFull, imp ? U.falta1(T.patternNames[imp.pattern], imp.gain) : T.almost);
          setText(u.faltaSh, imp ? U.falta1Short(imp.gain) : T.almost);
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
    setWon(i, pattern, prize) {
      won.set(i, { pattern, prize });
    },
    resetWon() {
      won.clear();
    },
    shuffle() {
      ui.forEach((u, i) => {
        if (!u.el.animate) return;
        const d = i % 2 ? 1 : -1;
        u.el.animate(
          [
            { transform: 'none', opacity: 1 },
            { transform: `translateX(${d * 28}px) rotate(${d * 3}deg) scale(.95)`, opacity: 0.3, offset: 0.45 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 520, delay: i * 70, easing: 'ease-in-out' },
        );
      });
    },
    popSeal(i) {
      const el = ui[i]?.seal;
      if (el?.animate)
        el.animate([{ transform: 'scale(.3)', opacity: 0.2 }, { transform: 'scale(1.25)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 420 });
    },
  };
}
