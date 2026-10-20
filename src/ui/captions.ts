// Legendas: mostra em letra grande o que a voz fala. Um unico timeout reutilizado (sem setInterval).
import { h, setText } from './dom';

export interface Captions {
  el: HTMLElement;
  /** prio maior nao e substituida por prio menor enquanto estiver no tempo minimo */
  show(text: string, prio?: number, ms?: number): void;
  setEnabled(on: boolean): void;
  destroy(): void;
}

export function createCaptions(): Captions {
  const el = h('div', 'caption', '', { 'aria-hidden': 'true' });
  let timer = 0;
  let curPrio = 0;
  let holdUntil = 0;
  let enabled = true;

  const clear = () => {
    el.classList.remove('on', 'hot');
  };

  return {
    el,
    show(text, prio = 1, ms = 2200) {
      if (!enabled) return;
      const now = performance.now();
      if (now < holdUntil && prio < curPrio) return;
      curPrio = prio;
      holdUntil = now + Math.min(ms, 1400);
      setText(el, text);
      el.classList.add('on');
      el.classList.toggle('hot', prio >= 3);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        curPrio = 0;
        clear();
      }, ms);
    },
    setEnabled(on) {
      enabled = on;
      if (!on) {
        window.clearTimeout(timer);
        clear();
      }
    },
    destroy() {
      window.clearTimeout(timer);
    },
  };
}
