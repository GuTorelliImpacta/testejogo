// Legenda = EXATAMENTE a fala que tocou (M9). A integracao liga `setSpokenCaption` ao `onCaption` do audio.
// Sem fala ativa mostra o texto de estado padrao. Mensagens visuais nao faladas ('FALTA 1!') usam `flash`.
import { h, setText } from './dom';

export interface Captions {
  el: HTMLElement;
  /** Texto de estado padrao (mostrado quando nao ha fala nem aviso visual). */
  setState(text: string): void;
  /** Aviso visual nao falado, por `ms`. Nao sobrescreve fala ativa. */
  flash(text: string, ms?: number): void;
  setEnabled(on: boolean): void;
  destroy(): void;
}

const instances = new Set<{ spoken(t: string): void }>();

/** Chamar com o texto de cada fala; texto vazio = fim da fala (volta ao texto de estado). */
export function setSpokenCaption(text: string): void {
  for (const c of instances) c.spoken(text);
}

export function createCaptions(): Captions {
  const el = h('div', 'caption', '', { 'aria-hidden': 'true' });
  let enabled = true;
  let spoken = '';
  let state = '';
  let visual = '';
  let visualTimer = 0;
  let spokenTimer = 0;

  const paint = () => {
    const t = spoken || visual || state;
    setText(el, enabled ? t : '');
    el.classList.toggle('on', enabled && !!t);
    el.classList.toggle('spk', !!spoken);
    el.classList.toggle('hot', !spoken && !!visual);
  };

  const inst = {
    spoken(t: string) {
      spoken = (t ?? '').trim();
      window.clearTimeout(spokenTimer);
      // seguranca: se o fim da fala nunca chegar, volta ao estado apos 12 s
      if (spoken) spokenTimer = window.setTimeout(() => { spoken = ''; paint(); }, 12000);
      paint();
    },
  };
  instances.add(inst);

  return {
    el,
    setState(text) {
      if (text === state) return;
      state = text;
      paint();
    },
    flash(text, ms = 2200) {
      visual = text;
      window.clearTimeout(visualTimer);
      visualTimer = window.setTimeout(() => { visual = ''; paint(); }, ms);
      paint();
    },
    setEnabled(on) {
      enabled = on;
      paint();
    },
    destroy() {
      instances.delete(inst);
      window.clearTimeout(visualTimer);
      window.clearTimeout(spokenTimer);
    },
  };
}
