import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seededRng, randInt } from '../src/rng';
import { generateCards } from '../src/cards';
import { levelOf } from '../src/patterns';
import { playRound, RoundSession } from '../src/round';
import { buildPlan, buildPlanDetailed, evaluatePlan, MAX_ATTEMPTS } from '../src/drawBuilder';
import type { DrawTarget } from '../src/drawBuilder';
import type { DrawPlan, PatternId } from '../src/types';
import { activePatterns, setPatternSet, PATTERN_SETS } from '../src/config';
import type { PatternSetName } from '../src/config';
import { MAX_NUMBER } from '../src/types';

const ALL4 = [true, true, true, true];

for (const SET of ['classico', 'variado'] as PatternSetName[]) {
  describe(`conjunto ${SET}`, () => {
    beforeAll(() => setPatternSet(SET));
    afterAll(() => setPatternSet('classico'));


    function assertValidPlan(plan: DrawPlan) {
      expect(plan.main).toHaveLength(30);
      expect(new Set(plan.main).size).toBe(30);
      expect(plan.extras.length).toBeGreaterThanOrEqual(1);
      expect(plan.extras.length).toBeLessThanOrEqual(9);
      const all = [...plan.main, ...plan.extras];
      expect(new Set(all).size).toBe(all.length);
      for (const n of all) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(MAX_NUMBER);
      }
    }

    const tiers = (): (PatternId | null)[] => [null, ...activePatterns().filter((p) => p !== 'bingo')];
    const TOP = (): PatternId => activePatterns().filter((p) => p !== 'bingo').pop()!;

    function randomTarget(rng: () => number, active: boolean[]): DrawTarget {
      const idx = active.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
      const focus = idx[randInt(idx.length, rng)];
      const caps: (PatternId | null)[] = active.map(() => tiers()[randInt(tiers().length, rng)]);
      const kind = randInt(7, rng);
      if (kind === 0) {
        caps[focus] = 'bingo';
        return { maxPattern: caps, bingo: { at: 'main' }, focus };
      }
      if (kind === 1) {
        caps[focus] = 'bingo';
        return { maxPattern: caps, bingo: { at: 'extra' }, focus };
      }
      if (kind === 2) return { maxPattern: caps, almost: true, focus };
      const extra = (['none', 'miss', 'hit', undefined] as const)[randInt(4, rng)];
      return { maxPattern: caps, extra, focus };
    }

    describe('drawBuilder: sequências válidas', () => {
      it('30 distintas + extras distintas, tudo em 1..90, para alvos variados', () => {
        for (let seed = 1; seed <= 120; seed++) {
          const rng = seededRng(seed);
          const cards = generateCards(rng);
          const t = randomTarget(rng, ALL4);
          assertValidPlan(buildPlan(cards, ALL4, t, rng));
        }
      });

      it('funciona com cartelas inativas e com uma única cartela', () => {
        for (let seed = 1; seed <= 40; seed++) {
          const rng = seededRng(1000 + seed);
          const cards = generateCards(rng);
          const active = [false, seed % 2 === 0, false, seed % 3 === 0 || seed % 2 === 1];
          if (!active.some(Boolean)) active[0] = true;
          const t = randomTarget(rng, active);
          assertValidPlan(buildPlan(cards, active, t, rng));
        }
      });
    });

    describe('drawBuilder: nunca excede o alvo', () => {
      it('resultado real (compra todas as extras) <= teto de cada cartela, em muitas seeds', () => {
        for (let seed = 1; seed <= 400; seed++) {
          const rng = seededRng(seed * 31);
          const cards = generateCards(rng);
          const t = randomTarget(rng, ALL4);
          const r = buildPlanDetailed(cards, ALL4, t, rng);
          expect(r.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
          const { summary } = playRound(cards, ALL4, 5, 5000, r.plan, true);
          summary.results.forEach((res, i) => {
            const cap = r.target.bingo && i === (r.target.focus ?? -1) ? 'bingo' : r.target.maxPattern[i] ?? null;
            if (r.target.almost && i === r.target.focus) {
              expect(res.pattern).not.toBe('bingo');
              return;
            }
            expect(levelOf(res.pattern)).toBeLessThanOrEqual(levelOf(cap));
          });
        }
      });

      it('tetos baixos: cartelas nulas nunca ganham nada', () => {
        for (let seed = 1; seed <= 200; seed++) {
          const rng = seededRng(77000 + seed);
          const cards = generateCards(rng);
          const caps: (PatternId | null)[] = [null, null, null, null];
          if (seed % 2) caps[seed % 4] = 'linha';
          const plan = buildPlan(cards, ALL4, { maxPattern: caps, extra: 'none' }, rng);
          const { summary } = playRound(cards, ALL4, 5, 5000, plan, true);
          summary.results.forEach((res, i) => expect(levelOf(res.pattern)).toBeLessThanOrEqual(levelOf(caps[i])));
        }
      });
    });

    describe('drawBuilder: alvos de bingo', () => {
      it('bingo na principal: bola decisiva entre 24 e 30 e acumulado', () => {
        let validated = 0;
        for (let seed = 1; seed <= 80; seed++) {
          const rng = seededRng(500 + seed);
          const cards = generateCards(rng);
          const f = seed % 4;
          const caps: (PatternId | null)[] = [null, null, null, null];
          caps[f] = 'bingo';
          const r = buildPlanDetailed(cards, ALL4, { maxPattern: caps, bingo: { at: 'main' }, focus: f }, rng);
          if (!r.target.bingo) continue;
          validated++;
          const ev = evaluatePlan(cards, ALL4, r.plan);
          expect(ev.mainBingoAt).not.toBeNull();
          expect(ev.mainBingoAt!).toBeGreaterThanOrEqual(23);
          expect(ev.mainBingoAt!).toBeLessThanOrEqual(29);
          const s = new RoundSession(cards, ALL4, 5, 5000, r.plan);
          while (s.nextMain()) {
            /* sorteia */
          }
          expect(s.jackpotHit).toBe(true);
          expect(s.finish().results[f].pattern).toBe('bingo');
        }
        expect(validated).toBeGreaterThanOrEqual(70);
      });

      it('bingo via extra: falta 1 após as 30 e a extra 1..N completa', () => {
        let validated = 0;
        for (let seed = 1; seed <= 80; seed++) {
          const rng = seededRng(900 + seed);
          const cards = generateCards(rng);
          const f = seed % 4;
          const caps: (PatternId | null)[] = [null, null, null, null];
          caps[f] = 'bingo';
          const r = buildPlanDetailed(cards, ALL4, { maxPattern: caps, bingo: { at: 'extra' }, focus: f }, rng);
          if (!r.target.bingo) continue;
          validated++;
          const ev = evaluatePlan(cards, ALL4, r.plan);
          expect(ev.mainBingoAt).toBeNull();
          expect(ev.almostAfterMain).toContain(f);
          expect(ev.offeredAfterMain).toBe(true);
          expect(ev.bingoOnExtra).toBe(true);
          const { summary, bingoOnExtra } = playRound(cards, ALL4, 5, 5000, r.plan, true);
          expect(bingoOnExtra).toBe(true);
          expect(summary.jackpot).toBe(0);
          expect(summary.results[f].pattern).toBe('bingo');
          expect(summary.extrasUsed).toBeLessThanOrEqual(9);
        }
        expect(validated).toBeGreaterThanOrEqual(70);
      });

      it('quase-bingo: falta 1, há oferta e as extras não completam', () => {
        let validated = 0;
        for (let seed = 1; seed <= 80; seed++) {
          const rng = seededRng(1300 + seed);
          const cards = generateCards(rng);
          const f = seed % 4;
          const r = buildPlanDetailed(cards, ALL4, { maxPattern: [null, null, null, null], almost: true, focus: f }, rng);
          if (!r.target.almost) continue;
          validated++;
          const ev = evaluatePlan(cards, ALL4, r.plan);
          expect(ev.offeredAfterMain).toBe(true);
          expect(ev.extrasUsed).toBeGreaterThanOrEqual(1);
          expect(ev.almostAtEnd).toContain(f);
          expect(ev.patterns.includes('bingo')).toBe(false);
        }
        expect(validated).toBeGreaterThanOrEqual(70);
      });

      it('extra "none" não oferece bola; "hit" melhora na extra', () => {
        let none = 0;
        let hit = 0;
        for (let seed = 1; seed <= 60; seed++) {
          const rng = seededRng(2100 + seed);
          const cards = generateCards(rng);
          const caps: (PatternId | null)[] = [null, 'linha', null, null];
          const rn = buildPlanDetailed(cards, ALL4, { maxPattern: caps, extra: 'none', focus: 1 }, rng);
          if (rn.target.extra === 'none' && rn.downgrades === 0) {
            none++;
            expect(evaluatePlan(cards, ALL4, rn.plan).offeredAfterMain).toBe(false);
          }
          const rh = buildPlanDetailed(cards, ALL4, { maxPattern: caps, extra: 'hit', focus: 1 }, rng);
          if (rh.target.extra === 'hit') {
            hit++;
            const ev = evaluatePlan(cards, ALL4, rh.plan);
            expect(ev.offeredAfterMain).toBe(true);
            expect(ev.extraWins.some((w) => w.cardIndex === 1 && w.pattern === 'linha')).toBe(true);
          }
        }
        expect(none).toBeGreaterThan(40);
        expect(hit).toBeGreaterThan(40);
      });
    });

    describe('drawBuilder: robustez', () => {
      it('alvos impossíveis rebaixam e nunca travam (<= 200 tentativas)', () => {
        const t0 = Date.now();
        for (let seed = 1; seed <= 30; seed++) {
          const rng = seededRng(4000 + seed);
          const cards = generateCards(rng);
          // todas as cartelas exigem moldura + uma exige bingo: praticamente inviável
          const top = TOP();
          const caps: (PatternId | null)[] = [top, top, top, 'bingo'];
          const r = buildPlanDetailed(cards, ALL4, { maxPattern: caps, bingo: { at: 'main' }, focus: 3 }, rng);
          expect(r.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
          assertValidPlan(r.plan);
          const { summary } = playRound(cards, ALL4, 5, 5000, r.plan, true);
          summary.results.forEach((res, i) => {
            const cap = r.target.bingo && i === 3 ? 'bingo' : r.target.maxPattern[i];
            expect(levelOf(res.pattern)).toBeLessThanOrEqual(levelOf(cap ?? null));
          });
        }
        expect(Date.now() - t0).toBeLessThan(20000);
      });

      it('o conjunto ativo é o esperado', () => {
        expect(activePatterns()).toEqual(PATTERN_SETS[SET]);
      });

      it('tudo em 1..90 e extras <= 9 também com 9 extras compradas (grátis ou não) e plan.free arbitrário', () => {
        for (let seed = 1; seed <= 150; seed++) {
          const rng = seededRng(8000 + seed);
          const cards = generateCards(rng);
          const t = randomTarget(rng, ALL4);
          const r = buildPlanDetailed(cards, ALL4, t, rng);
          const free = r.plan.extras.map((_, i) => (seed + i) % 3 === 0);
          const plan: DrawPlan = { ...r.plan, free };
          const base = playRound(cards, ALL4, 5, 5000, r.plan, true).summary;
          const withFree = playRound(cards, ALL4, 5, 5000, plan, true).summary;
          // grátis só muda o custo, nunca o resultado
          expect(withFree.results.map((x) => x.pattern)).toEqual(base.results.map((x) => x.pattern));
          expect(withFree.extraCost).toBeLessThanOrEqual(base.extraCost);
          expect(withFree.freeExtras).toBeLessThanOrEqual(withFree.extrasUsed);
          r.target.maxPattern.forEach((cap, i) => {
            if (r.target.bingo && i === r.target.focus) return;
            if (r.target.almost && i === r.target.focus) return;
            expect(levelOf(withFree.results[i].pattern)).toBeLessThanOrEqual(levelOf(cap));
          });
        }
      });
    });

  });
}

// v3: alvos amostrados com cada combinação de presets continuam sendo teto (nunca excedidos)
import { sampleTarget, resolveTuning } from '../src/director';
import { DEFAULT_TUNING } from '../src/config';

for (const SET of ['classico', 'variado'] as PatternSetName[]) {
  describe(`alvos dos presets (${SET})`, () => {
    beforeAll(() => setPatternSet(SET));
    afterAll(() => setPatternSet('classico'));

    for (const nivel of ['menos', 'normal', 'mais'] as const) {
      it(`premiosDoDia/ofertaExtra=${nivel}: o resultado nunca excede o teto`, () => {
        const T = resolveTuning({ ...DEFAULT_TUNING, premiosDoDia: nivel, ofertaExtra: nivel });
        const rng = seededRng(4242);
        for (let i = 0; i < 120; i++) {
          const cards = generateCards(rng);
          const target = sampleTarget(ALL4, i % 9 === 0, rng, T);
          const r = buildPlanDetailed(cards, ALL4, target, rng);
          const sum = playRound(cards, ALL4, 5, 5000, r.plan, true).summary;
          r.target.maxPattern.forEach((cap, k) => {
            if (r.target.bingo && k === r.target.focus) return;
            if (r.target.almost && k === r.target.focus) return;
            expect(levelOf(sum.results[k].pattern)).toBeLessThanOrEqual(levelOf(cap));
          });
        }
      });
    }
  });
}
