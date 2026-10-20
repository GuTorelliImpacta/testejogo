// Modais: premios, ajustes, oferta de bola extra, presente, celebracao, PIN e painel admin.
import type { GameApi, GameView } from '../gameApi';
import type { PatternId, RoundSummary, Settings } from '../types';
import { MULTIPLIER } from '../config';
import { MASKS } from '../patterns';
import { T } from '../texts';
import { btn, cloverSvg, fmt, h, setText, setCls } from './dom';
import { U } from './uitext';

export type Local = 'prizes' | 'settings' | 'pin' | 'admin' | null;

interface Layer {
  layer: HTMLElement;
  dlg: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
}

/** Dialogo com cabecalho e rodape fixos; so o miolo (`body`) poderia rolar (nunca precisa). */
function layer(cls = '', label = ''): Layer {
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
  let lastView: GameView | null = null;

  const setLocal = (l: Local) => {
    local = l;
    onLocalChange();
  };
  const closeBtn = (fn: () => void = () => setLocal(null)) => btn('green', U.close, fn, 300);

  // ------------------------------------------------ premios (com desenhos)
  const P = layer('', T.prizes);
  P.head.append(h('h2', '', U.prizesTitle));
  const pSub = h('p');
  P.head.append(pSub);
  const ptable = h('div', 'ptable');
  const jk = h('div', 'prow jk');
  const jkT = h('div', 'pn', T.jackpot);
  const jkRule = h('small', '', U.jackpotRule);
  jkT.append(jkRule);
  const jkV = h('div', 'pv');
  jk.append(jkT, jkV);
  P.body.append(ptable, jk);
  P.foot.append(closeBtn());
  let pSig = '';
  const pRows = new Map<string, HTMLElement>();
  const buildPrizes = (v: GameView) => {
    ptable.textContent = '';
    pRows.clear();
    for (const { pattern: pat } of [...v.prizeTable].reverse()) {
      const row = h('div', 'prow');
      const mini = h('div', 'mini');
      const mask = MASKS[pat][0];
      for (let k = 0; k < 15; k++) mini.append(h('i', (mask >> k) & 1 ? 'x' : ''));
      const pn = h('div', 'pn');
      pn.append(h('span', '', T.patternNames[pat]));
      pn.append(h('small', '', `×${MULTIPLIER[pat]}` + (MASKS[pat].length > 1 && pat !== 'bingo' ? ` (${U.any})` : '')));
      const pv = h('div', 'pv');
      row.append(mini, pn, pv);
      ptable.append(row);
      pRows.set(pat, pv);
    }
  };

  // ------------------------------------------------ ajustes (3 abas, sem rolagem)
  const S = layer('', T.settings);
  S.head.append(h('h2', '', T.settings));
  const tabsEl = h('div', 'tabs', undefined, { role: 'tablist' });
  const panes: Record<string, HTMLElement> = { som: h('div', 'pane'), jogo: h('div', 'pane'), tela: h('div', 'pane') };
  const tabBtns: Record<string, HTMLButtonElement> = {};
  let tab = 'som';
  const showTab = (t: string) => {
    tab = t;
    for (const k in panes) {
      setCls(panes[k], 'hide', k !== t);
      tabBtns[k].setAttribute('aria-pressed', k === t ? 'true' : 'false');
    }
  };
  for (const [k, label] of [['som', U.tabSound], ['jogo', U.tabGame], ['tela', U.tabScreen]] as const) {
    tabBtns[k] = btn('tab', label, () => showTab(k), 150);
    tabBtns[k].setAttribute('role', 'tab');
    tabsEl.append(tabBtns[k]);
    S.body.append(panes[k]);
  }
  S.head.append(tabsEl);

  const segBtns: Record<string, HTMLButtonElement[]> = {};
  const mkSeg = (pane: HTMLElement, title: string, key: keyof Settings, opts: [string, unknown][]) => {
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
    pane.append(box);
  };
  /** Liga/desliga com um unico botao grande ao lado do nome. */
  const toggles: { b: HTMLButtonElement; get: (v: GameView) => boolean; on: string; off: string }[] = [];
  const mkToggle = (pane: HTMLElement, title: string, get: (v: GameView) => boolean, set: (on: boolean) => void, on: string, off: string) => {
    const row = h('div', 'trow');
    row.append(h('h3', '', title));
    const b = btn('tg', off, () => set(!get(lastView!)), 200);
    row.append(b);
    pane.append(row);
    toggles.push({ b, get, on, off });
  };
  const meters: { key: 'volMusic' | 'volVoice' | 'volSfx'; pips: HTMLElement[] }[] = [];
  const mkVol = (label: string, key: 'volMusic' | 'volVoice' | 'volSfx') => {
    const row = h('div', 'vol');
    const step = (d: number) => {
      const cur = lastView?.settings[key] ?? 0.5;
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
    panes.som.append(row);
    meters.push({ key, pips });
  };
  mkVol(U.music, 'volMusic');
  mkVol(U.voice, 'volVoice');
  mkVol(U.effects, 'volSfx');
  mkSeg(panes.jogo, U.speed, 'speed', [[U.slow, 'lenta'], [U.normal, 'normal'], [U.fast, 'rapida']]);
  mkToggle(panes.jogo, U.turboSet, (v) => v.turbo, (on) => api.setTurbo(on), U.turboOn, U.turboOff);
  mkToggle(panes.jogo, U.autoSet, (v) => v.auto, (on) => api.setAuto(on), U.turboOn, U.turboOff);
  mkToggle(panes.jogo, U.bordoes, (v) => v.settings.bordoes, (on) => api.updateSettings({ bordoes: on }), U.turboOn, U.turboOff);
  mkSeg(panes.tela, U.textSize, 'textSize', [[U.sizeNormal, 'normal'], [U.sizeBig, 'grande'], [U.sizeHuge, 'muito']]);
  mkToggle(panes.tela, U.captions, (v) => v.settings.captions, (on) => api.updateSettings({ captions: on }), U.on, U.offs);
  mkToggle(panes.tela, U.light, (v) => v.settings.light, (on) => api.updateSettings({ light: on, lightManual: true }), U.lightOn, U.lightOff);
  S.foot.append(closeBtn());
  showTab('som');

  // ------------------------------------------------ presente
  const G = layer('', T.giftTitle);
  const gIc = h('div', 'gift-ic');
  gIc.innerHTML = cloverSvg();
  const gTitle = h('h2', '', T.giftTitle);
  const gBody = h('div', 'bigprize');
  G.body.append(gIc, gTitle, gBody);
  G.foot.append(btn('big green', T.take, () => api.takeGift()));

  // ------------------------------------------------ correio da sorte (tela grande)
  const M = layer('mailay', U.mailTitle);
  const mIc = h('div', 'gift-ic');
  mIc.innerHTML = cloverSvg();
  const mTitle = h('h2', '', `🍀 ${U.mailTitle}`);
  const mBody = h('div', 'bigprize');
  M.body.append(mIc, mTitle, mBody);
  M.foot.append(btn('big green', T.take, () => api.claimMail(), 500));

  // ------------------------------------------------ celebracao
  const C = layer('', T.congrats);
  let celebOn = false;
  let confetti: HTMLElement | null = null;
  let contBtn: HTMLButtonElement | null = null;

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
    C.body.textContent = '';
    C.foot.textContent = '';
    if (confetti) confetti.remove();
    confetti = null;
    const best = s.best;
    const isBingo = best === 'bingo';
    const jack = s.jackpot > 0;
    const wrap = h('div', 'celeb stack');
    wrap.append(h('div', 'big' + (isBingo ? '' : ' sm'), isBingo ? T.bingoBig : best ? T.patternShout[best] : T.won));
    if (jack) wrap.append(h('div', 'sub', T.jackpotWon));
    wrap.append(h('div', 'sub', T.congrats));
    const prize = h('div', 'bigprize', '+0');
    wrap.append(prize);
    C.body.append(wrap);
    contBtn = btn('big green', T.continue, () => api.continueCelebration());
    C.foot.append(contBtn);
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
  N.head.append(h('h2', '', U.pinTitle));
  const nDots = h('div', 'dots');
  const dotEls = [0, 1, 2, 3].map(() => nDots.appendChild(h('i')));
  const nMsg = h('p', 'pinmsg', '');
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
    h('span'),
    btn('', '0', () => addKey('0'), 80),
    btn('', U.del, () => {
      pin = pin.slice(0, -1);
      refreshDots();
    }, 80),
  );
  N.body.append(nDots, nMsg, keys);
  N.foot.append(closeBtn(() => { pin = ''; refreshDots(); setLocal(null); }));

  const A = layer('', U.adminTitle);
  A.dlg.classList.add('adm');
  const aSnap = h('pre');
  const aText = h('textarea', '', undefined, { rows: '3', 'aria-label': 'JSON', spellcheck: 'false', placeholder: 'JSON' });
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
  A.head.append(h('h2', '', U.adminTitle));
  A.body.append(aSnap, aText, aMsg, aRow1, aRow2);
  A.foot.append(closeBtn(() => { pend = null; setLocal(null); }));

  const all = [P, S, G, M, C, N, A];

  // Esc fecha modais locais
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && local) setLocal(null);
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  let shownLocal: Local = null;
  let lastGiftKey = '';
  let lastMailKey = '';

  return {
    layers: all.map((x) => x.layer),
    local: () => local,
    open(l) {
      if (l === 'pin') {
        pin = '';
        refreshDots();
        setText(nMsg, '');
      }
      if (l === 'settings') showTab(tab);
      setLocal(l);
    },
    sync(v, opts) {
      lastView = v;
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
        const sig = v.prizeTable.map((p) => p.pattern).join(',');
        if (sig !== pSig) {
          pSig = sig;
          buildPrizes(v);
        }
        setText(pSub, U.prizesFor(v.bet));
        for (const { pattern, prize } of v.prizeTable) {
          const el = pRows.get(pattern);
          if (el) setText(el, fmt(prize));
        }
        setText(jkV, fmt(v.jackpot * v.jackpotShare));
        setText(jkRule, U.jackpotRuleShare(v.jackpotShare));
      }
      if (showS) {
        for (const key in segBtns)
          for (const b of segBtns[key]) {
            const cur = String((v.settings as unknown as Record<string, unknown>)[key]);
            b.setAttribute('aria-pressed', b.dataset.val === cur ? 'true' : 'false');
          }
        for (const t of toggles) {
          const on = t.get(v);
          setText(t.b, on ? t.on : t.off);
          t.b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        for (const m of meters) {
          const n = Math.round(v.settings[m.key] * 10);
          m.pips.forEach((p, i) => setCls(p, 'on', i < n));
        }
      }

      // ---- por fase
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

      // correio: so em 'idle' (nunca durante sorteio nem sobre a oferta de extra)
      const mail = !!v.mail && v.mail.open && v.phase === 'idle';
      setCls(M.layer, 'hide', !mail);
      if (mail && v.mail) {
        const k = `${v.mail.amount}`;
        if (k !== lastMailKey) {
          lastMailKey = k;
          setText(mBody, U.mailAmount(v.mail.amount));
          focusFirst(M.dlg);
        }
      } else lastMailKey = '';

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
      void contBtn;
    },
  };
}
