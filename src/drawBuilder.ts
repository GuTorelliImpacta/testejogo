import type { Card, DrawPlan, PatternId } from './types';
import { BALLS_EXTRA_MAX, BALLS_MAIN, MAX_NUMBER, PATTERN_ORDER } from './types';
import type { Rng } from './rng';
import { randInt, shuffle } from './rng';
import { MASKS, bestPattern, bestReachableByOne, levelOf, missing } from './patterns';
import { markedMask } from './cards';
import { RoundSession } from './round';

/**
 * Modo de bola extra desejado para a rodada:
 *  - 'none': nenhuma oferta de bola extra depois das 30 bolas;
 *  - 'miss': há oferta, mas as extras não melhoram nenhuma cartela;
 *  - 'hit' : há oferta e uma das extras completa o padrão (maxPattern da cartela `focus`).
 * Sem valor: sem restrição sobre a oferta (as extras nunca melhoram além do planejado).
 */
export type ExtraMode = 'none' | 'miss' | 'hit';

export interface DrawTarget {
  /** Teto E alvo por cartela (null = nada). Cartelas inativas são ignoradas. */
  maxPattern: (PatternId | null)[];
  /** Bingo na cartela `focus` (ou a única com maxPattern 'bingo'): bola decisiva nas 24-30 ou numa extra. */
  bingo?: { at: 'main' | 'extra' };
  /** Quase-bingo: a cartela `focus` fica a 1 número do bingo e as extras não completam. */
  almost?: boolean;
  extra?: ExtraMode;
  /** Cartela protagonista (bingo / quase / hit / miss). Padrão: primeira ativa. */
  focus?: number;
}

export interface BuildResult {
  plan: DrawPlan;
  /** Alvo realmente atendido (pode ser mais baixo que o pedido). */
  target: DrawTarget;
  attempts: number;
  /** Quantas vezes o alvo foi rebaixado. */
  downgrades: number;
  /** false se nem o alvo mais baixo foi validado (plano de emergência). */
  validated: boolean;
}

export const MAX_ATTEMPTS = 200;

// ---------------------------------------------------------------------------
// Avaliação (oráculo = RoundSession com compra de todas as extras oferecidas)
// ---------------------------------------------------------------------------

export interface Evaluation {
  patterns: (PatternId | null)[];
  offeredAfterMain: boolean;
  mainBingoAt: number | null; // índice 0-based da bola principal do bingo
  bingoOnExtra: boolean;
  extrasUsed: number;
  extraWins: { index: number; cardIndex: number; pattern: PatternId }[];
  /** Cartelas ativas a exatamente 1 número do bingo (sem terem bingo) no fim da rodada. */
  almostAtEnd: number[];
  /** Idem, ao fim das 30 bolas. */
  almostAfterMain: number[];
}

export function evaluatePlan(cards: Card[], active: boolean[], plan: DrawPlan): Evaluation {
  const s = new RoundSession(cards, active, 1, 1, plan);
  let mainBingoAt: number | null = null;
  for (;;) {
    const st = s.nextMain();
    if (!st) break;
    if (st.bingo && mainBingoAt === null) mainBingoAt = st.index;
  }
  const almostOf = (): number[] => {
    const out: number[] = [];
    cards.forEach((c, i) => {
      if (!active[i]) return;
      const m = markedMask(c, s.drawn);
      if (m !== 0x7fff && missing(m, 'bingo') === 1) out.push(i);
    });
    return out;
  };
  const almostAfterMain = almostOf();
  const offeredAfterMain = s.offerCost() > 0;
  let bingoOnExtra = false;
  const extraWins: Evaluation['extraWins'] = [];
  while (s.offerCost() > 0) {
    const r = s.buyExtra();
    if (!r) break;
    if (r.step.bingo) bingoOnExtra = true;
    for (const w of r.step.won) extraWins.push({ index: r.step.index, cardIndex: w.cardIndex, pattern: w.pattern });
  }
  const sum = s.finish();
  return {
    patterns: sum.results.map((r) => r.pattern),
    offeredAfterMain,
    mainBingoAt,
    bingoOnExtra,
    extrasUsed: s.extrasUsed,
    extraWins,
    almostAtEnd: almostOf(),
    almostAfterMain,
  };
}

// ---------------------------------------------------------------------------
// Construção (uma tentativa)
// ---------------------------------------------------------------------------

interface Expect {
  expected: (PatternId | null)[];
  focus: number;
  bingoAt: 'main' | 'extra' | null;
  almost: boolean;
  mode: ExtraMode | undefined;
  hitPattern: PatternId | null;
}

interface Built {
  plan: DrawPlan;
  expect: Expect;
}

const ALL_NUMBERS = Array.from({ length: MAX_NUMBER }, (_, i) => i + 1);
const EXTRA_BINGO_POS = [1, 1, 2, 2, 3, 3, 4, 5, 6];
const EXTRA_HIT_POS = [1, 1, 2, 2, 3, 4];
const EXTRA_SHORT = [1, 1, 1, 2, 2, 3];
const EXTRA_ALMOST = [1, 1, 1, 1, 1, 2, 2];

function firstActive(active: boolean[]): number {
  const i = active.findIndex(Boolean);
  return i < 0 ? 0 : i;
}

function resolveFocus(t: DrawTarget, active: boolean[]): number {
  if (t.focus !== undefined && active[t.focus]) return t.focus;
  if (t.bingo) {
    const b = t.maxPattern.findIndex((p, i) => p === 'bingo' && active[i]);
    if (b >= 0) return b;
  }
  return firstActive(active);
}

/** Máscara do padrão que exige menos números novos (desempate aleatório). */
function cheapestMask(
  card: Card,
  pattern: PatternId,
  have: ReadonlySet<number>,
  rng: Rng,
): number {
  const masks = shuffle(MASKS[pattern], rng);
  let best = masks[0];
  let bestNew = 99;
  for (const m of masks) {
    let fresh = 0;
    for (let c = 0; c < 15; c++) if (m & (1 << c) && !have.has(card.nums[c])) fresh++;
    if (fresh < bestNew) {
      bestNew = fresh;
      best = m;
    }
  }
  return best;
}

function cellsOf(mask: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < 15; c++) if (mask & (1 << c)) out.push(c);
  return out;
}

function attempt(
  cards: Card[],
  active: boolean[],
  t: DrawTarget,
  rng: Rng,
): Built | null {
  const n = cards.length;
  const focus = resolveFocus(t, active);
  const bingoAt = t.bingo ? t.bingo.at : null;
  const almost = !!t.almost && !t.bingo;
  const mode = t.bingo || almost ? undefined : t.extra;

  const cellOf = cards.map((c) => {
    const m = new Map<number, number>();
    c.nums.forEach((v, i) => m.set(v, 1 << i));
    return m;
  });
  const capLv = cards.map((_, i) => (active[i] ? levelOf(t.maxPattern[i] ?? null) : 99));
  const expected: (PatternId | null)[] = cards.map((_, i) => (active[i] ? t.maxPattern[i] ?? null : null));
  const marks = new Array<number>(n).fill(0);
  const main = new Set<number>();
  const reserved = new Set<number>(); // não podem aparecer no sorteio principal nem em extras (exceto no slot planejado)
  let hitX: number | null = null;
  let hitPattern: PatternId | null = null;
  let bingoNums: number[] | null = null;

  const lvl = (m: number) => levelOf(bestPattern(m));

  const safe = (num: number): boolean => {
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      const bit = cellOf[i].get(num);
      if (bit && lvl(marks[i] | bit) > capLv[i]) return false;
    }
    return true;
  };
  const put = (num: number): void => {
    main.add(num);
    for (let i = 0; i < n; i++) {
      const bit = cellOf[i].get(num);
      if (bit && active[i]) marks[i] |= bit;
    }
  };
  const tryAdd = (num: number): boolean => {
    if (main.has(num)) return true;
    if (reserved.has(num)) return false;
    if (!safe(num)) return false;
    put(num);
    return true;
  };
  const offerIn = (ms: number[]): boolean => {
    for (let i = 0; i < n; i++) if (active[i] && bestReachableByOne(ms[i])) return true;
    return false;
  };

  const needsOwnMask = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) if (active[i] && t.maxPattern[i]) needsOwnMask[i] = true;

  // --- estrutura da cartela protagonista ---------------------------------
  const fc = cards[focus];
  if (bingoAt || almost) {
    const all = fc.nums;
    if (bingoAt === 'main') {
      bingoNums = all.slice();
      needsOwnMask[focus] = false;
      expected[focus] = 'bingo';
      capLv[focus] = levelOf('bingo');
      for (const v of all) if (!tryAdd(v)) return null;
    } else {
      // Quase-bingo: o número que falta é de borda (a cartela fica em linha dupla, não em moldura).
      const BORDER = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14];
      const x = bingoAt === 'extra' ? all[randInt(15, rng)] : all[BORDER[randInt(BORDER.length, rng)]];
      reserved.add(x);
      hitX = bingoAt === 'extra' ? x : null;
      needsOwnMask[focus] = false;
      const rest = all.filter((v) => v !== x);
      if (bingoAt === 'extra') {
        expected[focus] = 'bingo';
        capLv[focus] = levelOf('bingo');
        hitPattern = 'bingo';
      } else {
        let m = 0;
        for (const v of rest) m |= cellOf[focus].get(v)!;
        const p = bestPattern(m);
        expected[focus] = p;
        capLv[focus] = levelOf(p);
      }
      for (const v of rest) if (!tryAdd(v)) return null;
    }
  } else if (mode === 'hit') {
    const p = t.maxPattern[focus] ?? null;
    if (!p) return null;
    const mask = cheapestMask(fc, p, main, rng);
    const cells = cellsOf(mask);
    const xc = cells[randInt(cells.length, rng)];
    hitX = fc.nums[xc];
    hitPattern = p;
    reserved.add(hitX);
    needsOwnMask[focus] = false;
    for (const c of cells) if (c !== xc && !tryAdd(fc.nums[c])) return null;
  } else if (mode === 'miss') {
    const cur = t.maxPattern[focus] ?? null;
    const next = PATTERN_ORDER[levelOf(cur)];
    if (!next || next === 'bingo') return null;
    if (cur) {
      const own = cheapestMask(fc, cur, main, rng);
      for (const c of cellsOf(own)) if (!tryAdd(fc.nums[c])) return null;
    }
    needsOwnMask[focus] = false;
    const mask = cheapestMask(fc, next, main, rng);
    const cells = cellsOf(mask);
    const xc = cells[randInt(cells.length, rng)];
    reserved.add(fc.nums[xc]);
    for (const c of cells) if (c !== xc && !tryAdd(fc.nums[c])) return null;
  }

  // --- demais cartelas: números exigidos pelo padrão-alvo -----------------
  const order = shuffle(
    cards.map((_, i) => i).filter((i) => needsOwnMask[i]),
    rng,
  ).sort((a, b) => levelOf(t.maxPattern[b] ?? null) - levelOf(t.maxPattern[a] ?? null));
  for (const i of order) {
    const p = t.maxPattern[i]!;
    const mask = cheapestMask(cards[i], p, main, rng);
    for (const c of cellsOf(mask)) if (!tryAdd(cards[i].nums[c])) return null;
  }
  if (main.size > BALLS_MAIN) return null;

  // --- preenchimento das bolas principais ---------------------------------
  const cand = shuffle(
    ALL_NUMBERS.filter((v) => !main.has(v) && !reserved.has(v)),
    rng,
  );
  let ci = 0;
  while (main.size < BALLS_MAIN) {
    let found = false;
    while (ci < cand.length) {
      const v = cand[ci++];
      if (!safe(v)) continue;
      if (mode === 'none') {
        const probe = marks.slice();
        for (let i = 0; i < n; i++) {
          const bit = cellOf[i].get(v);
          if (bit && active[i]) probe[i] |= bit;
        }
        if (offerIn(probe)) continue;
      }
      put(v);
      found = true;
      break;
    }
    if (!found) return null;
  }
  if (mode === 'none' && offerIn(marks)) return null;

  // --- ordem das bolas principais -----------------------------------------
  let mainOrder: number[];
  if (bingoAt === 'main' && bingoNums) {
    const pos = BALLS_MAIN - 7 + randInt(7, rng); // 23..29 (bolas 24..30)
    const decisive = bingoNums[randInt(15, rng)];
    const others = shuffle(
      bingoNums.filter((v) => v !== decisive),
      rng,
    );
    const slots = shuffle(
      Array.from({ length: pos }, (_, i) => i),
      rng,
    );
    const arr = new Array<number>(BALLS_MAIN).fill(0);
    arr[pos] = decisive;
    const takenSlots = new Set<number>([pos]);
    for (let k = 0; k < others.length; k++) {
      arr[slots[k]] = others[k];
      takenSlots.add(slots[k]);
    }
    const inB = new Set(bingoNums);
    const fl = shuffle([...main].filter((v) => !inB.has(v)), rng);
    let f = 0;
    for (let s = 0; s < BALLS_MAIN; s++) if (!takenSlots.has(s)) arr[s] = fl[f++];
    mainOrder = arr;
  } else {
    mainOrder = shuffle([...main], rng);
  }

  // --- bolas extras --------------------------------------------------------
  // A lista termina logo após a bola decisiva (ou é curta: 1 a 3 bolas), para a oferta não se arrastar.
  let xSlot = -1;
  if (hitX !== null) {
    const pool = bingoAt === 'extra' ? EXTRA_BINGO_POS : EXTRA_HIT_POS;
    xSlot = pool[randInt(pool.length, rng)] - 1;
  }
  const shortList = almost ? EXTRA_ALMOST : EXTRA_SHORT;
  const total = xSlot >= 0 ? xSlot + 1 : shortList[randInt(shortList.length, rng)];
  const em = marks.slice();
  const curLv = em.map((m) => lvl(m));
  const used = new Set<number>(main);
  const extraCand = shuffle(
    ALL_NUMBERS.filter((v) => !used.has(v) && !reserved.has(v)),
    rng,
  );
  const extras: number[] = [];
  let ei = 0;
  for (let s = 0; s < total; s++) {
    if (s === xSlot && hitX !== null) {
      for (let i = 0; i < n; i++) {
        const bit = cellOf[i].get(hitX);
        if (!bit || !active[i]) continue;
        const nm = em[i] | bit;
        if (lvl(nm) > capLv[i]) return null;
        em[i] = nm;
        curLv[i] = lvl(nm);
      }
      extras.push(hitX);
      used.add(hitX);
      continue;
    }
    let found = false;
    while (ei < extraCand.length) {
      const v = extraCand[ei++];
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const bit = cellOf[i].get(v);
        if (bit && active[i] && lvl(em[i] | bit) !== curLv[i]) ok = false;
      }
      if (!ok) continue;
      for (let i = 0; i < n; i++) {
        const bit = cellOf[i].get(v);
        if (bit && active[i]) em[i] |= bit;
      }
      extras.push(v);
      found = true;
      break;
    }
    if (!found) return null;
  }

  return {
    plan: { main: mainOrder, extras },
    expect: { expected, focus, bingoAt, almost, mode, hitPattern },
  };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function capsRespected(ev: Evaluation, t: DrawTarget, active: boolean[], focus: number, e: Expect): boolean {
  for (let i = 0; i < ev.patterns.length; i++) {
    if (!active[i]) continue;
    const cap = i === focus && (e.almost || e.bingoAt) ? e.expected[i] : t.maxPattern[i] ?? null;
    if (levelOf(ev.patterns[i]) > levelOf(cap)) return false;
  }
  return true;
}

function satisfies(ev: Evaluation, active: boolean[], e: Expect): boolean {
  for (let i = 0; i < ev.patterns.length; i++) {
    if (!active[i]) continue;
    if (ev.patterns[i] !== e.expected[i]) return false;
  }
  if (e.bingoAt === 'main') {
    return ev.mainBingoAt !== null && ev.mainBingoAt >= BALLS_MAIN - 7 && !ev.bingoOnExtra;
  }
  if (e.bingoAt === 'extra') {
    return ev.mainBingoAt === null && ev.bingoOnExtra && ev.offeredAfterMain;
  }
  if (e.almost) {
    return (
      ev.offeredAfterMain &&
      ev.extrasUsed >= 1 &&
      ev.almostAfterMain.includes(e.focus) &&
      ev.almostAtEnd.includes(e.focus) &&
      ev.mainBingoAt === null &&
      !ev.bingoOnExtra
    );
  }
  if (e.mode === 'none') return !ev.offeredAfterMain;
  if (e.mode === 'miss') return ev.offeredAfterMain && ev.extrasUsed >= 1 && ev.extraWins.length === 0;
  if (e.mode === 'hit') {
    return ev.offeredAfterMain && ev.extraWins.some((w) => w.cardIndex === e.focus && w.pattern === e.hitPattern);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Rebaixamento e API pública
// ---------------------------------------------------------------------------

function lower(p: PatternId | null): PatternId | null {
  const lv = levelOf(p);
  return lv <= 1 ? null : PATTERN_ORDER[lv - 2];
}

function downgrade(t: DrawTarget, active: boolean[]): DrawTarget | null {
  const focus = resolveFocus(t, active);
  if (t.bingo) {
    const mp = t.maxPattern.slice();
    mp[focus] = 'moldura';
    return { maxPattern: mp, extra: 'none', focus };
  }
  if (t.almost) return { maxPattern: t.maxPattern.slice(), extra: 'none', focus };
  if (t.extra && t.extra !== 'none') return { maxPattern: t.maxPattern.slice(), extra: 'none', focus };
  if (t.maxPattern.some((p, i) => active[i] && p)) {
    return { maxPattern: t.maxPattern.map(lower), extra: 'none', focus };
  }
  return null;
}

/**
 * Monta 30 bolas + 10 extras coerentes com o alvo e devolve também o alvo efetivo.
 * Rejection sampling (<= 200 tentativas no total); se falhar, rebaixa o alvo; nunca trava.
 */
export function buildPlanDetailed(
  cards: Card[],
  active: boolean[],
  target: DrawTarget,
  rng: Rng,
): BuildResult {
  const ladder: DrawTarget[] = [target];
  for (;;) {
    const nx = downgrade(ladder[ladder.length - 1], active);
    if (!nx || ladder.length >= 6) break;
    ladder.push(nx);
  }
  // Último degrau: tudo nulo, sem restrição de oferta.
  const floor: DrawTarget = { maxPattern: cards.map(() => null) };
  if (JSON.stringify(ladder[ladder.length - 1]) !== JSON.stringify(floor)) ladder.push(floor);

  const budget = MAX_ATTEMPTS;
  const share = ladder.map((_, i) =>
    i === 0 ? 0.35 : i === ladder.length - 1 ? 0.25 : 0.4 / Math.max(1, ladder.length - 2),
  );
  let attempts = 0;
  let fallbackPlan: DrawPlan | null = null;
  let fallbackTarget = floor;

  for (let s = 0; s < ladder.length && attempts < budget; s++) {
    const t = ladder[s];
    const tries = Math.max(8, Math.round(budget * share[s]));
    for (let k = 0; k < tries && attempts < budget; k++) {
      attempts++;
      const built = attempt(cards, active, t, rng);
      if (!built) continue;
      const ev = evaluatePlan(cards, active, built.plan);
      if (satisfies(ev, active, built.expect)) {
        return { plan: built.plan, target: t, attempts, downgrades: s, validated: true };
      }
      if (!fallbackPlan && capsRespected(ev, t, active, built.expect.focus, built.expect)) {
        fallbackPlan = built.plan;
        fallbackTarget = t;
      }
    }
  }
  if (fallbackPlan) {
    return { plan: fallbackPlan, target: stripFlags(fallbackTarget), attempts, downgrades: ladder.length, validated: false };
  }
  // Emergência: sequência aleatória válida (nunca trava).
  const perm = shuffle(ALL_NUMBERS, rng);
  return {
    plan: { main: perm.slice(0, BALLS_MAIN), extras: perm.slice(BALLS_MAIN, BALLS_MAIN + BALLS_EXTRA_MAX) },
    target: floor,
    attempts,
    downgrades: ladder.length,
    validated: false,
  };
}

function stripFlags(t: DrawTarget): DrawTarget {
  return { maxPattern: t.maxPattern.slice() };
}

export function buildPlan(cards: Card[], active: boolean[], target: DrawTarget, rng: Rng): DrawPlan {
  return buildPlanDetailed(cards, active, target, rng).plan;
}
