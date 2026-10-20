import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seededRng } from '../src/rng';
import { generateCards } from '../src/cards';
import { playRound } from '../src/round';
import { TUNING, setPatternSet, activePatterns } from '../src/config';
import type { PatternSetName } from '../src/config';
import type { DirectorState } from '../src/types';
import {
  DAY_MS,
  afterRound,
  bingoChance,
  diasDesdeUltimoBingo,
  initialDirector,
  monthKey,
  planRound,
  rollFree,
  DIRECTOR_PARAMS,
} from '../src/director';

const ACTIVE = [true, true, true, true];
const T0 = new Date(2026, 9, 20, 10, 0, 0).getTime();
// início de mês (sem reforço de fim de mês) para testar a rampa pura
const TM = new Date(2026, 10, 2, 10, 0, 0).getTime();

function state(over: Partial<DirectorState>): DirectorState {
  return { ...initialDirector(T0 - 60 * DAY_MS), ...over };
}

describe('Diretor: estado', () => {
  it('initialDirector e afterRound', () => {
    const d0 = initialDirector(T0);
    expect(d0.ultimoBingoEm).toBeNull();
    expect(d0.primeiroUsoEm).toBe(T0);
    expect(d0.bingosPorMes).toEqual({});
    // primeiro uso = último bingo há 5 dias
    expect(diasDesdeUltimoBingo(d0, T0)).toBeCloseTo(5, 6);

    const d1 = afterRound(d0, T0 + 1000, false);
    expect(d1.rodadasDesdeUltimoBingo).toBe(1);
    expect(d1.historicoBingos).toEqual([]);
    expect(d0.rodadasDesdeUltimoBingo).toBe(0); // imutável

    const d2 = afterRound(d1, T0 + 2000, true);
    expect(d2.ultimoBingoEm).toBe(T0 + 2000);
    expect(d2.rodadasDesdeUltimoBingo).toBe(0);
    expect(d2.bingosPorMes[monthKey(T0)]).toBe(1);
    expect(d2.historicoBingos).toEqual([T0 + 2000]);
    const d3 = afterRound(d2, T0 + 3000, true);
    expect(d3.bingosPorMes['2026-10']).toBe(2);
    expect(monthKey(new Date(2027, 0, 5).getTime())).toBe('2027-01');
  });
});

describe('Diretor: chance de bingo', () => {
  it('proibido com menos de 7 dias desde o último bingo', () => {
    for (const dias of [0, 1, 3, 6, 6.99]) {
      const d = state({ ultimoBingoEm: T0 - dias * DAY_MS, rodadasDesdeUltimoBingo: 500 });
      expect(bingoChance(d, T0)).toBe(0);
    }
    const ok = state({ ultimoBingoEm: T0 - 7.5 * DAY_MS, rodadasDesdeUltimoBingo: 100 });
    expect(bingoChance(ok, T0)).toBeGreaterThan(0);
  });

  it('proibido ao atingir o teto do mês, mesmo após 30 dias', () => {
    const d = state({
      ultimoBingoEm: T0 - 30 * DAY_MS,
      rodadasDesdeUltimoBingo: 1000,
      bingosPorMes: { [monthKey(T0)]: TUNING.bingoMaxPorMes },
    });
    expect(bingoChance(d, T0)).toBe(0);
    const noutro = { ...d, bingosPorMes: { '2026-09': 3 } };
    expect(bingoChance(noutro, T0)).toBeGreaterThan(0);
  });

  it('cresce com os dias e passa a ser quase certa depois de 16 dias', () => {
    const base = (dias: number) =>
      state({ ultimoBingoEm: T0 - dias * DAY_MS, rodadasDesdeUltimoBingo: Math.round(dias * 40) });
    const c8 = bingoChance({ ...base(8), ultimoBingoEm: TM - 8 * DAY_MS }, TM);
    const c12 = bingoChance({ ...base(12), ultimoBingoEm: TM - 12 * DAY_MS }, TM);
    const c15 = bingoChance({ ...base(15), ultimoBingoEm: TM - 15 * DAY_MS }, TM);
    expect(c8).toBeGreaterThan(0);
    expect(c12).toBeGreaterThan(c8);
    expect(c15).toBeGreaterThan(c12);
    expect(bingoChance({ ...base(17), ultimoBingoEm: TM - 17 * DAY_MS }, TM)).toBeGreaterThan(c15);
    // primeiro uso: bingo possível já na primeira ou segunda semana (5 dias fictícios + 2)
    expect(bingoChance(afterRounds(initialDirector(T0 - 3 * DAY_MS), 300), T0)).toBeGreaterThan(0);
  });

  it('depois de 16 dias o bingo sai em ~20 rodadas jogadas', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = seededRng(seed);
      let d: DirectorState = state({ ultimoBingoEm: T0 - 16.01 * DAY_MS, rodadasDesdeUltimoBingo: 16 * 30 });
      let now = T0;
      let jogadas = 0;
      let saiu = false;
      const cards = generateCards(rng);
      while (jogadas < 45 && !saiu) {
        const { plan, intendedBingo } = planRound({ cards, active: ACTIVE, bet: 5, now, director: d, rng });
        const { summary } = playRound(cards, ACTIVE, 5, 5000, plan, true);
        const had = summary.results.some((r) => r.pattern === 'bingo');
        expect(had).toBe(intendedBingo);
        saiu = had;
        d = afterRound(d, now, had);
        now += DAY_MS / 30; // ritmo de ~30 rodadas/dia
        jogadas++;
      }
      expect(saiu).toBe(true);
      expect(jogadas).toBeLessThanOrEqual(26);
    }
  });
});

function afterRounds(d: DirectorState, n: number): DirectorState {
  let s = d;
  for (let i = 0; i < n; i++) s = afterRound(s, T0, false);
  return s;
}

describe('Diretor: simulação de 150 dias', () => {
  it('respeita mínimo de 7 dias, máximo mensal, e a intenção coincide com o resultado real', () => {
    const rng = seededRng(2024);
    let d = initialDirector(T0);
    const times: number[] = [];
    const perMonth: Record<string, number> = {};
    const RPD = 12;
    let cards = generateCards(rng);
    let intendedMismatch = 0;
    for (let day = 0; day < 150; day++) {
      for (let r = 0; r < RPD; r++) {
        const now = T0 + day * DAY_MS + (r * 12 * 3_600_000) / RPD;
        if ((day * RPD + r) % 6 === 0) cards = generateCards(rng);
        const { plan, intendedBingo } = planRound({ cards, active: ACTIVE, bet: 5, now, director: d, rng });
        const { summary } = playRound(cards, ACTIVE, 5, 5000, plan, true);
        const had = summary.results.some((x) => x.pattern === 'bingo');
        if (had !== intendedBingo) intendedMismatch++;
        if (had) {
          times.push(now);
          const k = monthKey(now);
          perMonth[k] = (perMonth[k] ?? 0) + 1;
        }
        d = afterRound(d, now, had);
      }
    }
    expect(intendedMismatch).toBe(0);
    expect(times.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(TUNING.diasMinEntreBingos * DAY_MS);
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(19 * DAY_MS);
    }
    for (const n of Object.values(perMonth)) expect(n).toBeLessThanOrEqual(TUNING.bingoMaxPorMes);
    expect(d.historicoBingos).toEqual(times);
    // primeiro bingo em até ~2 semanas do primeiro uso
    expect((times[0] - T0) / DAY_MS).toBeLessThanOrEqual(11);
  }, 60_000);

  it('planRound com bingo proibido nunca gera bingo', () => {
    const d = state({ ultimoBingoEm: T0 - 2 * DAY_MS, rodadasDesdeUltimoBingo: 5000 });
    for (let seed = 1; seed <= 150; seed++) {
      const rng = seededRng(seed);
      const cards = generateCards(rng);
      const { plan, intendedBingo } = planRound({ cards, active: ACTIVE, bet: 5, now: T0, director: d, rng });
      expect(intendedBingo).toBe(false);
      const { summary } = playRound(cards, ACTIVE, 5, 5000, plan, true);
      expect(summary.results.some((r) => r.pattern === 'bingo')).toBe(false);
    }
  });
});

describe('Diretor: bola extra grátis (plan.free)', () => {
  it('rollFree: uma flag por extra e ~17,5% verdadeiras', () => {
    const rng = seededRng(7);
    const f = rollFree(20000, rng);
    expect(f).toHaveLength(20000);
    const share = f.filter(Boolean).length / f.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.2);
    expect(DIRECTOR_PARAMS.chanceGratis).toBeGreaterThanOrEqual(0.15);
    expect(DIRECTOR_PARAMS.chanceGratis).toBeLessThanOrEqual(0.2);
  });

  it('planRound devolve plan.free com o mesmo tamanho das extras; grátis não custa e não muda o resultado', () => {
    const d = state({ ultimoBingoEm: T0 - 2 * DAY_MS, rodadasDesdeUltimoBingo: 50 });
    let offers = 0;
    let free = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const rng = seededRng(seed);
      const cards = generateCards(rng);
      const { plan } = planRound({ cards, active: ACTIVE, bet: 5, now: T0, director: d, rng });
      expect(plan.free).toBeDefined();
      expect(plan.free!).toHaveLength(plan.extras.length);
      expect(plan.extras.length).toBeLessThanOrEqual(9);
      const withFlags = playRound(cards, ACTIVE, 5, 5000, plan, true).summary;
      const noFlags = playRound(cards, ACTIVE, 5, 5000, { ...plan, free: undefined }, true).summary;
      expect(withFlags.results.map((r) => r.pattern)).toEqual(noFlags.results.map((r) => r.pattern));
      expect(withFlags.extraCost).toBeLessThanOrEqual(noFlags.extraCost);
      expect(withFlags.extrasUsed).toBe(noFlags.extrasUsed);
      offers += withFlags.extrasUsed;
      free += withFlags.freeExtras;
    }
    expect(offers).toBeGreaterThan(100);
    expect(free / offers).toBeGreaterThan(0.1);
    expect(free / offers).toBeLessThan(0.26);
  });
});

for (const SET of ['classico', 'variado'] as PatternSetName[]) {
  describe(`Diretor: conjunto ${SET}`, () => {
    beforeAll(() => setPatternSet(SET));
    afterAll(() => setPatternSet('classico'));

    it('alvo por cartela só usa padrões do conjunto ativo; resultado real respeita o plano', () => {
      const act = new Set(activePatterns());
      const d = state({ ultimoBingoEm: T0 - 2 * DAY_MS, rodadasDesdeUltimoBingo: 50 }); // bingo proibido
      let comPremio = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const rng = seededRng(5000 + seed);
        const cards = generateCards(rng);
        const { plan } = planRound({ cards, active: ACTIVE, bet: 5, now: T0, director: d, rng });
        const { summary } = playRound(cards, ACTIVE, 5, 5000, plan, true);
        for (const r of summary.results) {
          if (r.pattern) {
            comPremio++;
            expect(act.has(r.pattern)).toBe(true);
            expect(r.pattern).not.toBe('bingo');
          }
        }
      }
      expect(comPremio).toBeGreaterThan(30);
    });

    it('bingo forçado (após 16 dias) sai com a intenção do Diretor e dentro de 90 bolas', () => {
      const d = state({ ultimoBingoEm: T0 - 20 * DAY_MS, rodadasDesdeUltimoBingo: 20 * 30 });
      let bingos = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const rng = seededRng(9000 + seed);
        const cards = generateCards(rng);
        const { plan, intendedBingo } = planRound({ cards, active: ACTIVE, bet: 5, now: T0, director: d, rng });
        for (const n of [...plan.main, ...plan.extras]) {
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(90);
        }
        const { summary } = playRound(cards, ACTIVE, 5, 5000, plan, true);
        const had = summary.results.some((r) => r.pattern === 'bingo');
        expect(had).toBe(intendedBingo);
        if (had) bingos++;
      }
      expect(bingos).toBeGreaterThan(40);
    });

    it('sorteio das rodadas comuns: frequências na faixa (sem prêmio 50-68%)', () => {
      const d = state({ ultimoBingoEm: T0 - 2 * DAY_MS, rodadasDesdeUltimoBingo: 50 });
      let none = 0;
      const N = 500;
      for (let seed = 1; seed <= N; seed++) {
        const rng = seededRng(12000 + seed);
        const cards = generateCards(rng);
        const { plan } = planRound({ cards, active: ACTIVE, bet: 5, now: T0, director: d, rng });
        const { summary } = playRound(cards, ACTIVE, 5, 5000, plan, true);
        if (!summary.best) none++;
      }
      expect(none / N).toBeGreaterThan(0.5);
      expect(none / N).toBeLessThan(0.68);
    }, 60_000);
  });
}
