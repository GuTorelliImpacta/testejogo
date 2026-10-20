// Painel do neto: abas grandes (Resumo, Jogo, PIN, Aparelho), sem digitar numeros soltos e sem rolagem.
// Em telas pequenas cada aba vira "paginas" com setas; em telas grandes todas as paginas aparecem juntas (so CSS).
// Nunca mostra o PIN: so pontinhos.
import type { GameApi } from '../gameApi';
import type { AdminStats, DeviceInfo, PatternId, RuntimeTuning } from '../types';
import { DEFAULT_TUNING } from '../config';
import { PATTERN_ORDER } from '../types';
import { T } from '../texts';
import { btn, fmt, h, setCls } from './dom';
import { layer } from './layer';
import { U } from './uitext';

// ------------------------------------------------ pecas reutilizaveis (PIN)
export function makeDots(): { el: HTMLElement; set(n: number): void } {
  const el = h('div', 'dots', undefined, { 'aria-hidden': 'true' });
  const dots = [0, 1, 2, 3].map(() => el.appendChild(h('i')));
  return { el, set: (n) => dots.forEach((d, i) => setCls(d, 'on', i < n)) };
}

/** Teclado numerico 3x4 (no celular deitado vira 6x2 por CSS). O espaco vazio fica depois do 9. */
export function makeKeypad(onKey: (k: string) => void, onDel: () => void): HTMLElement {
  const keys = h('div', 'keys');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) keys.append(btn('', k, () => onKey(k), 80));
  keys.append(h('span', 'kgap'), btn('', '0', () => onKey('0'), 80), btn('', U.del, onDel, 80));
  return keys;
}

// ------------------------------------------------ formatacao legivel
const pct = (x: number): string => (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const num1 = (x: number): string => x.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const optLabel: Record<string, string> = { '1': '1', '2': '2', '2-3': '2 a 3', '3-4': '3 a 4' };

/** Resume o userAgent: modelo/sistema e navegador. */
export function summarizeUA(ua: string, chromeVersion: string | null): { device: string; browser: string } {
  const and = /Android\s+([\d.]+)(?:;\s*([^;)]+?))?\s*(?:Build\/|;|\))/.exec(ua);
  const ios = /\((iPhone|iPad)[^)]*OS ([\d_]+)/.exec(ua);
  let device = '—';
  if (and) {
    const model = (and[2] || '').replace(/^wv$/, '').trim();
    device = `${model ? model + ' · ' : ''}Android ${and[1]}`;
  } else if (ios) device = `${ios[1]} · iOS ${ios[2].replace(/_/g, '.')}`;
  else if (/Windows/.test(ua)) device = 'Windows';
  else if (/Mac OS X/.test(ua)) device = 'Mac';
  else if (/Linux/.test(ua)) device = 'Linux';
  const wv = /; wv\)/.test(ua) || /Version\/[\d.]+ Chrome/.test(ua);
  const major = (chromeVersion || /Chrome\/(\d+)/.exec(ua)?.[1] || '').split('.')[0];
  let browser = '—';
  if (/SamsungBrowser\/(\d+)/.test(ua)) browser = 'Samsung ' + /SamsungBrowser\/(\d+)/.exec(ua)![1];
  else if (/Firefox\/(\d+)/.test(ua)) browser = 'Firefox ' + /Firefox\/(\d+)/.exec(ua)![1];
  else if (/Edg\/(\d+)/.test(ua)) browser = 'Edge ' + /Edg\/(\d+)/.exec(ua)![1];
  else if (major) browser = `${wv ? 'WebView' : 'Chrome'} ${major}`;
  else if (/Safari/.test(ua)) browser = 'Safari';
  return { device, browser };
}

// ------------------------------------------------ painel
export interface Admin {
  layer: HTMLElement;
  dlg: HTMLElement;
  /** Chamado ao abrir (depois do PIN certo): atualiza tudo e volta ao Resumo. */
  open(): void;
  destroy(): void;
}

interface Pane {
  el: HTMLElement;
  pages: HTMLElement[];
  pager: HTMLElement;
  cur: number;
  go(i: number): void;
}

export function createAdmin(api: GameApi, onClose: () => void): Admin {
  const L = layer('adm-layer', U.adminTitle);
  L.dlg.classList.add('adm', 'hrow');
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };

  // ---- cabecalho: titulo + abas ----
  const title = h('h2', 'admt', U.adminTitle);
  const tabsEl = h('div', 'tabs', undefined, { role: 'tablist' });
  L.head.append(title, tabsEl);

  // ---- panes com paginas ----
  const mkPane = (cls: string, pages: HTMLElement[], noPager = false): Pane => {
    const el = h('div', `pane apane ${cls}`);
    const holder = h('div', 'pgs');
    pages.forEach((p, i) => {
      p.classList.add('pg');
      holder.append(p);
      void i;
    });
    el.append(holder);
    const pager = h('div', 'pager');
    const prev = btn('pgb', '◀', () => pane.go(pane.cur - 1), 150);
    prev.setAttribute('aria-label', U.pagePrev);
    const lab = h('span', 'pgl');
    const next = btn('pgb', '▶', () => pane.go(pane.cur + 1), 150);
    next.setAttribute('aria-label', U.pageNext);
    pager.append(prev, lab, next);
    if (!noPager && pages.length > 1) el.append(pager);
    const pane: Pane = {
      el,
      pages,
      pager,
      cur: 0,
      go(i) {
        pane.cur = Math.max(0, Math.min(pages.length - 1, i));
        pages.forEach((p, k) => setCls(p, 'cur', k === pane.cur));
        lab.textContent = U.pageOf(pane.cur + 1, pages.length);
        prev.disabled = pane.cur === 0;
        next.disabled = pane.cur === pages.length - 1;
      },
    };
    pane.go(0);
    return pane;
  };

  // ======== RESUMO ========
  const tile = (label: string, value: string, cls = ''): HTMLElement => {
    const t = h('div', 'tile ' + cls);
    t.append(h('span', 'tl', label), h('span', 'tv', value));
    return t;
  };
  const r1 = h('div', 'tiles');
  const r2 = h('div', 'rpg');
  const r3 = h('div', 'rpg');
  const r4 = h('div', 'tiles');
  const resumo = mkPane('p-resumo', [r1, r2, r3, r4]);
  const fillResumo = () => {
    for (const e of [r1, r2, r3, r4]) e.textContent = '';
    const st: AdminStats | null = api.admin.stats();
    if (!st) {
      r1.append(h('div', 'amsg', U.locked));
      return;
    }
    r1.append(
      tile(U.tCredits, fmt(st.creditos)),
      tile(U.tJackpot, fmt(st.acumulado)),
      tile(U.tRounds, fmt(st.rodadas)),
      tile(U.tPerDay, num1(st.rodadasPorDia)),
      tile(U.tRecharges, fmt(st.recargas)),
      tile(U.tLastBingo, U.daysAgo(st.diasDesdeUltimoBingo)),
    );
    const t3 = h('div', 'tiles');
    t3.append(tile(U.tBingoMonth, String(st.bingosNoMes)), tile(U.tRtpCommon, pct(st.rtpComum)), tile(U.tRtpTotal, pct(st.rtpTotal)));
    const bx = h('div', 'abox');
    bx.append(h('span', 'tl', U.lastBingos), h('span', 'tv sm', st.ultimosBingos.length ? st.ultimosBingos.slice(0, 8).join(' · ') : U.noneYet));
    r2.append(t3, bx);
    const bt = h('div', 'abox');
    const types = PATTERN_ORDER.filter((p) => (st.premiosPorTipo[p] ?? 0) > 0)
      .reverse()
      .map((p: PatternId) => `${T.patternNames[p]} ${fmt(st.premiosPorTipo[p] ?? 0)}`);
    bt.append(h('span', 'tl', U.byType), h('span', 'tv sm', types.length ? types.join(' · ') : U.noneYet));
    r3.append(bt);
    const c = st.tuning;
    const lvl = (v: string) => (v === 'menos' ? U.lvLess : v === 'mais' ? U.lvMore : U.lvNormal);
    r4.append(
      tile(U.cfgBingos, optLabel[c.bingosPorMes] ?? c.bingosPorMes),
      tile(U.cfgPrizes, lvl(c.premiosDoDia)),
      tile(U.cfgExtra, lvl(c.ofertaExtra)),
      tile(U.cfgFree, lvl(c.chanceGratis)),
      tile(U.cfgCost, c.custoExtra === 'barata' ? U.cheaper : U.lvNormal),
      tile(U.cfgGift, fmt(c.presente)),
      tile(U.cfgMail, fmt(c.correioDiario)),
      tile(U.cfgSet, c.conjuntoPadroes === 'variado' ? U.varied : U.classic),
    );
  };

  // ======== JOGO ========
  const note = h('div', 'anote', U.nextRound, { 'aria-live': 'polite' });
  type Def = { key: keyof RuntimeTuning; label: string; opts: [string | number, string][] };
  const lv = (): [string, string][] => [['menos', U.lvLess], ['normal', U.lvNormal], ['mais', U.lvMore]];
  const defs: Def[] = [
    { key: 'bingosPorMes', label: U.gBingos, opts: [['1', '1'], ['2', '2'], ['2-3', '2 a 3'], ['3-4', '3 a 4']] },
    { key: 'premiosDoDia', label: U.gPrizes, opts: lv() },
    { key: 'ofertaExtra', label: U.gExtraFreq, opts: lv() },
    { key: 'chanceGratis', label: U.gExtraFree, opts: lv() },
    { key: 'custoExtra', label: U.gExtraCost, opts: [['barata', U.cheaper], ['normal', U.lvNormal]] },
    { key: 'presente', label: U.gGift, opts: [[500, '500'], [1000, '1.000'], [2000, '2.000']] },
    { key: 'correioDiario', label: U.gMail, opts: [[300, '300'], [500, '500']] },
    { key: 'conjuntoPadroes', label: U.gSet, opts: [['classico', U.classic], ['variado', U.varied]] },
  ];
  const optBtns = new Map<keyof RuntimeTuning, HTMLButtonElement[]>();
  const mkGroup = (d: Def): HTMLElement => {
    const g = h('div', 'gbox');
    g.append(h('h3', 'gl', d.label));
    const seg = h('div', 'seg');
    const bs = d.opts.map(([val, label]) => {
      const b = btn('opt', label, () => {
        api.admin.setTuning({ [d.key]: val } as Partial<RuntimeTuning>);
        refreshTuning();
        note.textContent = U.saved;
        note.classList.add('ok');
      }, 200);
      b.dataset.val = String(val);
      if (String(DEFAULT_TUNING[d.key]) === String(val)) b.append(h('small', 'std', U.std));
      seg.append(b);
      return b;
    });
    optBtns.set(d.key, bs);
    g.append(seg);
    return g;
  };
  const jpage = (ks: number[]): HTMLElement => {
    const p = h('div', 'jpg');
    ks.forEach((k) => p.append(mkGroup(defs[k])));
    return p;
  };
  const bRestore: HTMLButtonElement = btn('opt restore', U.restore, () => sure('restore', bRestore, U.restore, () => {
    api.admin.resetTuning();
    refreshTuning();
    note.textContent = U.restored;
    note.classList.add('ok');
  }), 200);
  const jRestore = h('div', 'jpg jrest');
  jRestore.append(bRestore);
  const jogo = mkPane('p-jogo', [jpage([0, 1]), jpage([2, 3]), jpage([4, 5]), jpage([6, 7]), jRestore]);
  jogo.el.append(note);
  const refreshTuning = () => {
    const t = api.admin.getTuning();
    optBtns.forEach((bs, key) => bs.forEach((b) => b.setAttribute('aria-pressed', b.dataset.val === String(t[key]) ? 'true' : 'false')));
  };

  // ======== PIN (trocar) ========
  const pinPane = h('div', 'pinp');
  const pinTitle = h('div', 'pint', U.pinOld);
  const pinDots = makeDots();
  const pinMsg = h('div', 'amsg', U.pinHint, { 'aria-live': 'polite' });
  let step: 'old' | 'new' | 'again' = 'old';
  let cur = '';
  let oldPin = '';
  let newPin = '';
  const stepTitle = () => (step === 'old' ? U.pinOld : step === 'new' ? U.pinNew : U.pinAgain);
  const pinKeyboard = makeKeypad(
    (k) => {
      if (cur.length >= 4) return;
      cur += k;
      pinDots.set(cur.length);
      if (cur.length < 4) return;
      const done = cur;
      cur = '';
      pinDots.set(0);
      if (step === 'old') {
        oldPin = done;
        step = 'new';
        pinMsg.textContent = U.pinHint;
      } else if (step === 'new') {
        newPin = done;
        step = 'again';
        pinMsg.textContent = U.pinHint;
      } else {
        if (done !== newPin) {
          pinMsg.textContent = U.pinMismatch;
          step = 'new';
          newPin = '';
        } else {
          const ok = api.admin.changePin(oldPin, newPin);
          pinMsg.textContent = ok ? U.pinChanged : U.pinOldWrong;
          step = 'old';
          oldPin = '';
          newPin = '';
        }
      }
      pinTitle.textContent = stepTitle();
    },
    () => {
      cur = cur.slice(0, -1);
      pinDots.set(cur.length);
    },
  );
  const pinLeft = h('div', 'pinl');
  pinLeft.append(pinTitle, pinDots.el, pinMsg);
  pinPane.append(pinLeft, pinKeyboard);
  const pinTab = mkPane('p-pin', [pinPane], true);
  const resetPin = () => {
    step = 'old';
    cur = '';
    oldPin = '';
    newPin = '';
    pinDots.set(0);
    pinTitle.textContent = stepTitle();
    pinMsg.textContent = U.pinHint;
  };

  // ======== APARELHO ========
  const a1 = h('div', 'tiles');
  const a2 = h('div', 'tiles');
  const aText = h('textarea', 'atext', undefined, { rows: '2', 'aria-label': U.importHint, spellcheck: 'false', placeholder: U.importHint });
  const aMsg3 = h('div', 'amsg', '', { 'aria-live': 'polite' });
  const aMsg4 = h('div', 'amsg', '', { 'aria-live': 'polite' });
  const say = (t: string) => { aMsg3.textContent = t; aMsg4.textContent = t; };
  const a3 = h('div', 'apg');
  const bExp = btn('opt', U.export, () => doExport(), 300);
  const bImp = btn('opt', U.import, () => {
    const ok = api.admin.importJson(aText.value);
    say(ok ? U.importOk : U.importFail);
    if (ok) {
      aText.value = '';
      refreshAll();
    }
  }, 300);
  const rowEI = h('div', 'brow');
  rowEI.append(bExp, bImp);
  a3.append(rowEI, aText, aMsg3);
  const a4 = h('div', 'apg');
  const bJ: HTMLButtonElement = btn('opt', U.resetJackpot, () => sure('j', bJ, U.resetJackpot, () => { api.admin.resetJackpot(); say(U.jackpotReset); refreshAll(); }), 300);
  const bC: HTMLButtonElement = btn('opt', U.resetCredits, () => sure('c', bC, U.resetCredits, () => { api.admin.resetCredits(); say(U.creditsReset); refreshAll(); }), 300);
  const rowZ = h('div', 'brow');
  rowZ.append(bJ, bC);
  a4.append(rowZ, aMsg4);
  const aparelho = mkPane('p-aparelho', [a1, a2, a3, a4]);
  const fillDevice = () => {
    a1.textContent = '';
    a2.textContent = '';
    const d: DeviceInfo | null = api.admin.device();
    if (!d) {
      a1.append(h('div', 'amsg', U.locked));
      return;
    }
    const ua = summarizeUA(d.userAgent, d.chromeVersion);
    const dash = U.dash;
    a1.append(
      tile(U.dDevice, ua.device),
      tile(U.dBrowser, ua.browser),
      tile(U.dScreen, d.screen),
      tile(U.dWindow, d.viewport),
      tile(U.dDpr, String(d.dpr)),
      tile(U.dCores, d.cores === null ? dash : String(d.cores)),
    );
    a2.append(
      tile(U.dMemory, d.deviceMemory === null ? dash : `${d.deviceMemory} GB`),
      tile(U.dFps, d.fpsMedio === null ? dash : `${Math.round(d.fpsMedio)} FPS`),
      tile(U.dWorst, d.piorQuadroMs === null ? dash : `${Math.round(d.piorQuadroMs)} ms`),
      tile(U.dJsMem, d.memoriaJsMB === null ? dash : `${Math.round(d.memoriaJsMB)} MB`),
      tile(U.dEco, d.modoEconomico ? U.dOn : U.dOff),
      tile(U.dCache, d.sw || dash),
    );
  };

  function doExport(): void {
    const json = api.admin.exportJson();
    let copied = false;
    let saved = false;
    try {
      void navigator.clipboard?.writeText(json);
      copied = !!navigator.clipboard;
    } catch {
      /* ignora */
    }
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = h('a', '', '', { href: url, download: 'altina-backup.json' });
      a.click();
      later(() => URL.revokeObjectURL(url), 4000);
      saved = true;
    } catch {
      /* ignora */
    }
    if (copied || saved) say(U.exportedDone);
    else {
      // plano C: mostra o texto, mas com o PIN escondido (o PIN nunca aparece em claro)
      aText.value = json.replace(/("adminPin"\s*:\s*")\d{4}(")/, '$1••••$2');
      say(U.exportedMasked);
    }
  }

  // ---- confirmacao em dois toques (volta sozinha em 4 s) ----
  let pend: string | null = null;
  let pendBtn: HTMLButtonElement | null = null;
  let pendLabel = '';
  let pendTimer = 0;
  const clearPend = () => {
    if (pendBtn) pendBtn.textContent = pendLabel;
    pend = null;
    pendBtn = null;
    window.clearTimeout(pendTimer);
  };
  function sure(key: string, b: HTMLButtonElement, label: string, fn: () => void): void {
    if (pend === key) {
      clearPend();
      fn();
      return;
    }
    clearPend();
    pend = key;
    pendBtn = b;
    pendLabel = label;
    b.textContent = key === 'restore' ? U.restoreSure : U.sureAgain;
    pendTimer = later(clearPend, 4000);
  }

  // ---- abas ----
  const panes: [string, string, Pane, (() => void) | null][] = [
    ['resumo', U.adminTabs.resumo, resumo, fillResumo],
    ['jogo', U.adminTabs.jogo, jogo, refreshTuning],
    ['pin', U.adminTabs.pin, pinTab, resetPin],
    ['aparelho', U.adminTabs.aparelho, aparelho, fillDevice],
  ];
  const tabBtns: HTMLButtonElement[] = [];
  let tabIdx = 0;
  const showTab = (i: number) => {
    clearPend();
    tabIdx = i;
    panes.forEach(([, , p], k) => {
      setCls(p.el, 'hide', k !== i);
      tabBtns[k].setAttribute('aria-pressed', k === i ? 'true' : 'false');
    });
    const [, , p, fill] = panes[i];
    p.go(0);
    fill?.();
    say('');
    note.textContent = U.nextRound;
    note.classList.remove('ok');
  };
  panes.forEach(([k, label, p], i) => {
    const b = btn('tab', label, () => showTab(i), 150);
    b.setAttribute('role', 'tab');
    b.dataset.tab = k;
    tabBtns.push(b);
    tabsEl.append(b);
    L.body.append(p.el);
  });
  const refreshAll = () => panes[tabIdx][3]?.();

  L.foot.append(btn('green', U.adminClose, () => { clearPend(); api.admin.lock(); onClose(); }, 300));

  return {
    layer: L.layer,
    dlg: L.dlg,
    open() {
      resetPin();
      showTab(0);
    },
    destroy() {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    },
  };
}
