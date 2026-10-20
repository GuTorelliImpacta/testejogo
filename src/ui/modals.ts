// Modais: premios, ajustes, oferta de bola extra, presente, celebracao, PIN e painel admin.
import type { GameApi, GameView } from '../gameApi';
import type { PatternId, RoundSummary, Settings } from '../types';
import { PATTERN_ORDER } from '../types';
import { MULTIPLIER } from '../config';
import { MASKS } from '../patterns';
import { T } from '../texts';
import { btn, cloverSvg, fmt, h, setText, setCls } from './dom';
import { U } from './uitext';

export type Local = 'prizes' | 'settings' | 'pin' | 'admin' | null;

function layer(cls = '', label = ''): { layer: HTMLElement; dlg: HTMLElement } {
  const l = h('div', 'layer hide ' + cls);
  const d = h('div', 'dlg', undefined, { role: 'dialog', 'aria-modal': 'true' });
  if (label) d.setAttribute('aria-label', label);
  l.append(d);
  return { layer: l, dlg: d };
}

function focusFirst(root: HTMLElement): void {
  const f = root.querySelector<HTMLElement>('button:not(:disabled)');
  if (f) queueMicrotask(() => f.focus({ preventScroll: true }));
}
function focusDlg(root: HTMLElement): void {
  root.setAttribute('tabindex', '-1');
  queueMicrotask(() => root.focus({ preventScroll: true }));
}

export interface Modals {
  layers: HTMLElement[];
  sync(v: GameView, opts: { giftKind: 'gift' | 'daily'; light: boolean }): void;
  open(l: Local): void;
  local(): Local;
  destroy(): void;
}

export function createModals(api: GameApi, onLocalChange: () => void): Modals {
  let local: Local = null;
  let rafId = 0;
  const cleanups: (() => void)[] = [];

  const setLocal = (l: Local) => {
    local = l;
    onLocalChange();
  };

  // ------------------------------------------------ premios
  const P = layer('', T.prizes);
  P.dlg.append(h('h2', '', U.prizesTitle));
  const pSub = h('p');
  const ptable = h('div', 'ptable');
  const pRows: { name: HTMLElement; val: HTMLElement; pat: PatternId }[] = [];
  for (const pat of [...PATTERN_ORDER].reverse()) {
    const row = h('div', 'prow');
    const mini = h('div', 'mini');
    const mask = MASKS[pat][0];
    for (let k = 0; k < 15; k++) mini.append(h('i', (mask >> k) & 1 ? 'x' : ''));
    const pn = h('div', 'pn');
    const nm = h('span', '', T.patternNames[pat]);
    pn.append(nm);
    const sm = h('small', '', `×${MULTIPLIER[pat]}` + (MASKS[pat].length > 1 && pat !== 'bingo' ? ` (${U.any})` : ''));
    pn.append(sm);
    const pv = h('div', 'pv');
    row.append(mini, pn, pv);
    ptable.append(row);
    pRows.push({ name: nm, val: pv, pat });
  }
  const jk = h('div', 'prow jk');
  const jkT = h('div', 'pn', T.jackpot);
  jkT.append(h('small', '', U.jackpotRule));
  const jkV = h('div', 'pv');
  jk.append(jkT, jkV);
  const pClose = btn('green', U.close, () => setLocal(null), 300);
  P.dlg.append(pSub, ptable, jk, pClose);

  // ------------------------------------------------ ajustes
  const S = layer('', T.settings);
  S.dlg.append(h('h2', '', T.settings));
  const sgrid = h('div', 'sgrid');
  const segBtns: Record<string, HTMLButtonElement[]> = {};
  const mkSeg = (title: string, key: keyof Settings, opts: [string, unknown][]) => {
    const box = h('div', 'sset');
    box.append(h('h3', '', title));
    const seg = h('div', 'seg');
    segBtns[key] = opts.map(([label, val]) => {
      const b = btn('', label, () => api.updateSettings({ [key]: val } as Partial<Settings>), 150);
      b.dataset.val = String(val);
      seg.append(b);
      return b;
    });
    box.append(seg);
    sgrid.append(box);
  };
  mkSeg(U.speed, 'speed', [
    [U.slow, 'lenta'],
    [U.normal, 'normal'],
    [U.fast, 'rapida'],
  ]);
  mkSeg(U.captions, 'captions', [
    [U.on, true],
    [U.offs, false],
  ]);
  mkSeg(U.light, 'light', [
    [U.lightOn, true],
    [U.lightOff, false],
  ]);
  mkSeg(U.textSize, 'textSize', [
    [U.sizeNormal, 'normal'],
    [U.sizeBig, 'grande'],
    [U.sizeHuge, 'muito'],
  ]);
  const volBox = h('div', 'sset');
  volBox.append(h('h3', '', U.volumes));
  const meters: { key: 'volMusic' | 'volVoice' | 'volSfx'; pips: HTMLElement[] }[] = [];
  const mkVol = (label: string, key: 'volMusic' | 'volVoice' | 'volSfx') => {
    const row = h('div', 'vol');
    const step = (d: number) => {
      const cur = lastSettings?.[key] ?? 0.5;
      const nv = Math.min(1, Math.max(0, Math.round((cur + d) * 10) / 10));
      api.updateSettings({ [key]: nv } as Partial<Settings>);
    };
    const m = btn('sq', '−', () => step(-0.1), 100);
    m.setAttribute('aria-label', `${U.less} ${label}`);
    const p = btn('sq', '+', () => step(0.1), 100);
    p.setAttribute('aria-label', `${U.more} ${label}`);
    const meter = h('div', 'meter');
    const pips: HTMLElement[] = [];
    for (let i = 0; i < 10; i++) {
      const pip = h('i');
      pips.push(pip);
      meter.append(pip);
    }
    row.append(h('span', 'lab', label), m, meter, p);
    volBox.append(row);
    meters.push({ key, pips });
  };
  mkVol(U.music, 'volMusic');
  mkVol(U.voice, 'volVoice');
  mkVol(U.effects, 'volSfx');
  sgrid.append(volBox);
  S.dlg.append(sgrid, btn('green', U.close, () => setLocal(null), 300));
  let lastSettings: Settings | null = null;

  // ------------------------------------------------ oferta de bola extra
  const X = layer('soft sheet', T.extraOffer);
  X.dlg.classList.add('extra');
  const xTitle = h('h2', '', T.extraOffer);
  const xRem = h('div', 'xrem');
  const xBuy = btn('big gold', '', () => api.buyExtra());
  const xEnd = btn('big', T.finish, () => api.finishExtra());
  const xrow = h('div', 'xrow');
  xrow.append(xBuy, xEnd);
  X.dlg.append(xTitle, xrow, xRem);

  // ------------------------------------------------ presente
  const G = layer('', T.giftTitle);
  const gIc = h('div', 'gift-ic');
  gIc.innerHTML = cloverSvg();
  const gTitle = h('h2', '', T.giftTitle);
  const gBody = h('div', 'bigprize');
  const gBtn = btn('big green', T.take, () => api.takeGift());
  G.dlg.append(gIc, gTitle, gBody, gBtn);

  // ------------------------------------------------ celebracao
  const C = layer('', T.congrats);
  let celebOn = false;
  let confetti: HTMLElement | null = null;

  const countUp = (el: HTMLElement, to: number, ms: number, prefix = '+') => {
    cancelAnimationFrame(rafId);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setText(el, prefix + fmt(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  };

  function makeConfetti(n: number): HTMLElement {
    const box = h('div', 'confetti', undefined, { 'aria-hidden': 'true' });
    const colors = ['#ffd24a', '#ff5a4d', '#4da3ff', '#5be37d', '#d58bff', '#fff'];
    for (let i = 0; i < n; i++) {
      const isClover = i % 4 === 3;
      const e = h('i', isClover ? 'cl' : '');
      if (isClover) e.innerHTML = cloverSvg();
      else e.style.setProperty('--k', colors[i % colors.length]);
      e.style.setProperty('--x', String(Math.round((i / n) * 96 + 1)));
      e.style.setProperty('--dx', String(((i * 7) % 13) - 6));
      e.style.setProperty('--dur', (3 + ((i * 5) % 7) * 0.35).toFixed(2) + 's');
      e.style.setProperty('--dl', (-((i * 3) % 9) * 0.4).toFixed(2) + 's');
      e.style.setProperty('--rot', ((i % 2 ? 1 : -1) * (360 + (i % 5) * 120)) + 'deg');
      box.append(e);
    }
    return box;
  }

  function showCelebration(s: RoundSummary, light: boolean): void {
    C.dlg.textContent = '';
    if (confetti) confetti.remove();
    confetti = null;
    const best = s.best;
    const isBingo = best === 'bingo';
    const jack = s.jackpot > 0;
    const wrap = h('div', 'celeb stack');
    const big = h('div', 'big' + (isBingo ? '' : ' sm'), isBingo ? T.bingoBig : best ? T.patternShout[best] : T.won);
    wrap.append(big);
    if (jack) wrap.append(h('div', 'sub', T.jackpotWon));
    wrap.append(h('div', 'sub', T.congrats));
    const prize = h('div', 'bigprize', '+0');
    wrap.append(prize);
    const cont = btn('big green', T.continue, () => api.continueCelebration());
    C.dlg.append(wrap, cont);
    C.dlg.setAttribute('aria-label', T.congrats);
    if (!light) {
      confetti = makeConfetti(isBingo || jack ? 36 : 16);
      C.layer.prepend(confetti);
    }
    countUp(prize, s.prize, 1200);
    focusFirst(C.dlg);
  }

  // ------------------------------------------------ PIN e admin
  const N = layer('', U.pinTitle);
  let pin = '';
  const nTitle = h('h2', '', U.pinTitle);
  const nDots = h('div', 'dots');
  const dotEls = [0, 1, 2, 3].map(() => nDots.appendChild(h('i')));
  const nMsg = h('p', '', '');
  const keys = h('div', 'keys');
  const refreshDots = () => dotEls.forEach((d, i) => setCls(d, 'on', i < pin.length));
  const addKey = (k: string) => {
    if (pin.length >= 4) return;
    pin += k;
    refreshDots();
    if (pin.length === 4) {
      const ok = api.admin.unlock(pin);
      pin = '';
      refreshDots();
      if (ok) {
        setText(nMsg, '');
        refreshAdmin();
        setLocal('admin');
      } else setText(nMsg, U.pinWrong);
    }
  };
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) keys.append(btn('', k, () => addKey(k), 80));
  keys.append(
    btn('', U.del, () => {
      pin = pin.slice(0, -1);
      refreshDots();
    }, 80),
    btn('', '0', () => addKey('0'), 80),
    btn('', U.close, () => {
      pin = '';
      refreshDots();
      setLocal(null);
    }, 300),
  );
  N.dlg.append(nTitle, nDots, nMsg, keys);

  const A = layer('', U.adminTitle);
  A.dlg.classList.add('adm');
  const aSnap = h('pre');
  const aText = h('textarea', '', undefined, { rows: '4', 'aria-label': 'JSON', spellcheck: 'false', placeholder: 'JSON' });
  const aMsg = h('div', 'msg');
  let pend: string | null = null;
  const refreshAdmin = () => {
    try {
      aSnap.textContent = JSON.stringify(api.admin.snapshot(), null, 1);
    } catch {
      aSnap.textContent = '-';
    }
  };
  const sure = (key: string, fn: () => void, b: HTMLButtonElement, label: string) => {
    if (pend === key) {
      pend = null;
      b.textContent = label;
      fn();
      refreshAdmin();
    } else {
      pend = key;
      b.textContent = U.sure;
    }
  };
  const bExp = btn('', U.export, () => {
    const json = api.admin.exportJson();
    aText.value = json;
    try {
      void navigator.clipboard?.writeText(json);
    } catch {
      /* ignora */
    }
    try {
      const a = h('a', '', '', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: 'altina-backup.json' });
      a.click();
    } catch {
      /* ignora */
    }
    setText(aMsg, U.exported);
  }, 300);
  const bImp = btn('', U.import, () => {
    setText(aMsg, api.admin.importJson(aText.value) ? U.importOk : U.importFail);
    refreshAdmin();
  }, 300);
  const bJ: HTMLButtonElement = btn('', U.resetJackpot, () => sure('j', () => api.admin.resetJackpot(), bJ, U.resetJackpot), 300);
  const bC: HTMLButtonElement = btn('', U.resetCredits, () => sure('c', () => api.admin.resetCredits(), bC, U.resetCredits), 300);
  const aRow1 = h('div', 'row');
  aRow1.append(bExp, bImp);
  const aRow2 = h('div', 'row');
  aRow2.append(bJ, bC);
  A.dlg.append(h('h2', '', U.adminTitle), aSnap, aText, aMsg, aRow1, aRow2, btn('green', U.close, () => { pend = null; setLocal(null); }, 300));

  const all = [P, S, X, G, C, N, A];

  // Esc fecha modais locais
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && local) setLocal(null);
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  let shownLocal: Local = null;
  let lastExtraKey = '';
  let lastGiftKey = '';

  return {
    layers: all.map((x) => x.layer),
    local: () => local,
    open(l) {
      if (l === 'pin') {
        pin = '';
        refreshDots();
        setText(nMsg, '');
      }
      setLocal(l);
    },
    sync(v, opts) {
      lastSettings = v.settings;
      // ---- locais
      const showP = local === 'prizes';
      const showS = local === 'settings';
      const showN = local === 'pin';
      const showA = local === 'admin';
      setCls(P.layer, 'hide', !showP);
      setCls(S.layer, 'hide', !showS);
      setCls(N.layer, 'hide', !showN);
      setCls(A.layer, 'hide', !showA);
      if (local !== shownLocal) {
        shownLocal = local;
        const map = { prizes: P, settings: S, pin: N, admin: A } as const;
        if (local) focusDlg(map[local].dlg);
      }
      if (showP) {
        setText(pSub, U.prizesFor(v.bet));
        for (const r of pRows) setText(r.val, fmt(v.bet * MULTIPLIER[r.pat]));
        setText(jkV, fmt(v.jackpot));
      }
      if (showS) {
        for (const key in segBtns)
          for (const b of segBtns[key]) {
            const cur = String((v.settings as unknown as Record<string, unknown>)[key]);
            const on = b.dataset.val === cur;
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        for (const m of meters) {
          const n = Math.round(v.settings[m.key] * 10);
          m.pips.forEach((p, i) => setCls(p, 'on', i < n));
        }
      }

      // ---- por fase
      const ex = v.phase === 'extraOffer' && v.extraOffer;
      setCls(X.layer, 'hide', !ex);
      if (ex) {
        const k = `${ex.cost}|${ex.remaining}`;
        if (k !== lastExtraKey) {
          lastExtraKey = k;
          setText(xBuy, T.extraBall(ex.cost));
          setText(xRem, U.remaining(ex.remaining));
          focusFirst(X.dlg);
        }
      } else lastExtraKey = '';

      const gift = v.phase === 'gift';
      setCls(G.layer, 'hide', !gift);
      if (gift) {
        const k = `${v.giftAmount}|${opts.giftKind}`;
        if (k !== lastGiftKey) {
          lastGiftKey = k;
          setText(gTitle, opts.giftKind === 'daily' ? T.dailyTitle : T.giftTitle);
          setText(gBody, T.giftBody(v.giftAmount));
          focusFirst(G.dlg);
        }
      } else lastGiftKey = '';

      const cel = v.phase === 'celebrating' && !!v.summary;
      setCls(C.layer, 'hide', !cel);
      if (cel && !celebOn) {
        celebOn = true;
        showCelebration(v.summary!, opts.light);
      } else if (!cel && celebOn) {
        celebOn = false;
        cancelAnimationFrame(rafId);
        confetti?.remove();
        confetti = null;
      }
    },
    destroy() {
      cancelAnimationFrame(rafId);
      cleanups.forEach((f) => f());
    },
  };
}
