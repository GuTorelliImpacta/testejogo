// Camada de dialogo (cabecalho e rodape fixos) e utilitarios de foco, compartilhados por modals.ts e admin.ts.
import { h } from './dom';

export interface Layer {
  layer: HTMLElement;
  dlg: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
}

/** Dialogo com cabecalho e rodape fixos; so o miolo (`body`) poderia rolar (nunca precisa). */
export function layer(cls = '', label = ''): Layer {
  const l = h('div', 'layer hide ' + cls);
  const d = h('div', 'dlg', undefined, { role: 'dialog', 'aria-modal': 'true' });
  if (label) d.setAttribute('aria-label', label);
  const head = h('div', 'dlg-head');
  const body = h('div', 'dlg-body');
  const foot = h('div', 'dlg-foot');
  d.append(head, body, foot);
  l.append(d);
  return { layer: l, dlg: d, head, body, foot };
}

export function focusFirst(root: HTMLElement): void {
  const f = root.querySelector<HTMLElement>('button:not(:disabled)');
  if (f) queueMicrotask(() => f.focus({ preventScroll: true }));
}
export function focusDlg(root: HTMLElement): void {
  root.setAttribute('tabindex', '-1');
  queueMicrotask(() => root.focus({ preventScroll: true }));
}
