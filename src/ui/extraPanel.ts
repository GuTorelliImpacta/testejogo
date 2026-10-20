// Painel de bola extra: ocupa o lugar da bola grande (NAO e modal; as cartelas continuam visiveis).
import type { GameApi, GameView } from '../gameApi';
import { T } from '../texts';
import { btn, h, setCls, setText } from './dom';
import { U } from './uitext';

export interface ExtraPanel {
  el: HTMLElement;
  /** devolve true se o painel esta visivel */
  update(v: GameView): boolean;
}

export function createExtraPanel(api: GameApi): ExtraPanel {
  const el = h('div', 'xpanel hide', undefined, { role: 'group', 'aria-label': T.extraOffer });
  const title = h('div', 'xtitle');
  const rem = h('div', 'xrem');
  const buy = btn('big gold xbuy', '', () => api.buyExtra(), 500);
  const end = btn('big xend', T.finish, () => api.finishExtra(), 500);
  const row = h('div', 'xrow');
  row.append(buy, end);
  el.append(title, row, rem);
  let key = '';

  return {
    el,
    update(v) {
      const ex = v.phase === 'extraOffer' ? v.extraOffer : null;
      setCls(el, 'hide', !ex);
      if (!ex) {
        key = '';
        return false;
      }
      setCls(el, 'free', ex.free);
      setText(title, ex.free ? U.extraFreeTitle : U.extraTitle(ex.cost));
      setText(buy, ex.free ? U.extraBuyFree : U.extraBuy);
      setText(rem, U.remaining(ex.remaining));
      const k = `${ex.cost}|${ex.free}|${ex.remaining}`;
      if (k !== key) {
        key = k;
        queueMicrotask(() => buy.focus({ preventScroll: true }));
      }
      return true;
    },
  };
}
