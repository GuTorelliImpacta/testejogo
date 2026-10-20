// Tabela de premios FIXA (valores da aposta atual). E um botao: tocar abre "Premios" com os desenhos.
import type { GameView } from '../gameApi';
import type { PatternId } from '../types';
import { T } from '../texts';
import { fmt, h, press, setCls, setText } from './dom';
import { U } from './uitext';

interface Row {
  key: string;
  el: HTMLElement;
  nm: HTMLElement;
  pv: HTMLElement;
}

export interface PrizeView {
  el: HTMLButtonElement;
  update(v: GameView): void;
  /** pisca a linha do premio que acabou de sair por 2 s */
  flash(key: PatternId | 'jackpot'): void;
}

export function createPrizeTable(onOpen: () => void): PrizeView {
  const el = h('button', 'ptab', undefined, { type: 'button', 'aria-label': U.prizesOpen });
  press(el, onOpen, 300);
  const head = h('div', 'ph', U.prizesHead);
  const rowsEl = h('div', 'prows');
  el.append(head, rowsEl);
  let rows: Row[] = [];
  let sig = '';
  const timers = new Map<string, number>();

  const mk = (key: string): Row => {
    const e = h('div', 'pr');
    const nm = h('span', 'nm');
    const pv = h('span', 'pv');
    e.append(nm, pv);
    return { key, el: e, nm, pv };
  };

  return {
    el,
    update(v) {
      const keys = [...v.prizeTable.map((p) => p.pattern as string), 'jackpot'];
      const s = keys.join(',');
      if (s !== sig) {
        sig = s;
        rowsEl.textContent = '';
        rows = keys.map(mk);
        rows.forEach((r) => rowsEl.append(r.el));
        el.classList.toggle('many', keys.length > 4);
      }
      const share = v.jackpotShare;
      for (const r of rows) {
        if (r.key === 'jackpot') {
          const lbl = share < 1 ? U.jackpotPct(share) : T.jackpot;
          const sh = share < 1 ? U.jackpotPctShort(share) : U.jackpotShort;
          setRowName(r, lbl, sh);
          setText(r.pv, fmt(Math.floor(v.jackpot * share)));
          r.el.classList.add('jk');
        } else {
          const p = v.prizeTable.find((x) => x.pattern === r.key);
          const pat = r.key as PatternId;
          setRowName(r, T.patternNames[pat], U.shortNames[pat] ?? T.patternNames[pat]);
          setText(r.pv, p ? fmt(p.prize) : '');
        }
      }
    },
    flash(key) {
      const r = rows.find((x) => x.key === key);
      if (!r) return;
      r.el.classList.add('win');
      window.clearTimeout(timers.get(key));
      timers.set(key, window.setTimeout(() => setCls(r.el, 'win', false), 2000));
    },
  };
}

function setRowName(r: Row, full: string, short: string): void {
  const k = full + '|' + short;
  const e = r.nm as HTMLElement & { _k?: string };
  if (e._k === k) return;
  e._k = k;
  r.nm.textContent = '';
  r.nm.append(h('span', 'full', full), h('span', 'short', short));
}
