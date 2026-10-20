// Utilitarios de DOM (sem framework).
import { BALL_BAND } from '../config';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

type Cached = HTMLElement & { _t?: string };
/** Escreve texto somente se mudou (evita trabalho de layout desnecessario). */
export function setText(e: HTMLElement, s: string): void {
  const c = e as Cached;
  if (c._t !== s) {
    c._t = s;
    e.textContent = s;
  }
}

export function setCls(e: Element, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

export function setAttr(e: Element, k: string, v: string): void {
  if (e.getAttribute(k) !== v) e.setAttribute(k, v);
}

/** Botao com debounce (padrao 400 ms) para evitar toque duplo. */
export function press(e: HTMLElement, fn: () => void, debounceMs = 400): void {
  let last = -1e9;
  e.addEventListener('click', (ev) => {
    ev.preventDefault();
    if ((e as HTMLButtonElement).disabled) return;
    const now = performance.now();
    if (now - last < debounceMs) return;
    last = now;
    fn();
  });
}

export function btn(cls: string, label: string, onPress?: () => void, debounce = 400): HTMLButtonElement {
  const b = h('button', 'btn ' + cls, label, { type: 'button' });
  if (onPress) press(b, onPress, debounce);
  return b;
}

export const fmt = (n: number): string => Math.round(n).toLocaleString('pt-BR');

/** faixa da bola (blocos de BALL_BAND = 18): 1..5 */
export const range = (n: number): number => Math.min(5, Math.max(1, Math.floor((n - 1) / BALL_BAND) + 1));

export function cloverSvg(): string {
  return (
    '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
    '<g fill="#3fd16a" stroke="#0b6b2f" stroke-width="2.5" stroke-linejoin="round">' +
    '<path d="M0 0C-14-5-17-21-8-24-3-25 0-20 0-15 0-20 3-25 8-24 17-21 14-5 0 0z" transform="translate(32 33) rotate(45)"/>' +
    '<path d="M0 0C-14-5-17-21-8-24-3-25 0-20 0-15 0-20 3-25 8-24 17-21 14-5 0 0z" transform="translate(32 33) rotate(135)"/>' +
    '<path d="M0 0C-14-5-17-21-8-24-3-25 0-20 0-15 0-20 3-25 8-24 17-21 14-5 0 0z" transform="translate(32 33) rotate(225)"/>' +
    '<path d="M0 0C-14-5-17-21-8-24-3-25 0-20 0-15 0-20 3-25 8-24 17-21 14-5 0 0z" transform="translate(32 33) rotate(315)"/>' +
    '</g><path d="M32 34c0 9 3 16 9 22" fill="none" stroke="#ffd24a" stroke-width="4" stroke-linecap="round"/>' +
    '<circle cx="32" cy="33" r="3" fill="#ffd24a"/></svg>'
  );
}

export const ICONS = {
  mail: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="14" width="52" height="36" rx="6" fill="#fff8e1" stroke="#c9971c" stroke-width="3"/><path d="M8 18l24 18 24-18" fill="none" stroke="#c9971c" stroke-width="3" stroke-linejoin="round"/></svg>',
  turbo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 7h9V4l5 5-5 5v-3H7a3 3 0 0 0-3 3H2a5 5 0 0 1 5-5zm10 10H8v3l-5-5 5-5v3h9a3 3 0 0 0 3-3h2a5 5 0 0 1-5 5z"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3zm0 4H5v1a2 2 0 0 0 1 1.7zm12 0v2.7A2 2 0 0 0 19 8V7z"/></svg>',
  fast: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 6l9 6-9 6zm9 0l9 6-9 6z"/></svg>',
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5V2L7 6l5 4V7a5 5 0 0 1 4.6 7h2.2A7 7 0 0 0 12 5zm-5.6 5H4.2A7 7 0 0 0 12 19v3l5-4-5-4v3a5 5 0 0 1-5.6-7z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3h-4l-.4 3a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3h4l.4-3a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9zm12.6 1.4L17 12l-1.4 1.6 1.4 1.4 1.6-1.6L20.2 15l1.4-1.4L20 12l1.6-1.6L20.2 9 18.6 10.6 17 9z"/></svg>',
};
