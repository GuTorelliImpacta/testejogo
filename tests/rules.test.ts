import { describe, it, expect, afterEach } from 'vitest';
import { generateCard, generateCards, isValidCard, markedMask } from '../src/cards';
import { MASKS, bestPattern, missing, popcount, bestReachableByOne } from '../src/patterns';
import { prizeFor, extraCost, niceRound, prizeTable, jackpotPayout } from '../src/payout';
import { setPatternSet, activePatterns } from '../src/config';
import { RoundSession, playRound } from '../src/round';
import { seededRng } from '../src/rng';
import type { Card, DrawPlan } from '../src/types';

const rng = seededRng(42);
const fixed: Card = { nums: [1, 20, 38, 56, 73, 5, 25, 40, 60, 80, 9, 30, 50, 65, 90] };
afterEach(() => setPatternSet('classico'));

describe('cartelas', () => {
  it('gera cartelas válidas', () => {
    for (let i = 0; i < 500; i++) expect(isValidCard(generateCard(rng))).toBe(true);
  });
  it('gera 4 cartelas', () => expect(generateCards(rng)).toHaveLength(4));
  it('usa faixas de 18 por coluna (1–90)', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCard(rng);
      for (let k = 0; k < 15; k++) {
        const col = k % 5;
        expect(c.nums[k]).toBeGreaterThanOrEqual(18 * col + 1);
        expect(c.nums[k]).toBeLessThanOrEqual(18 * col + 18);
      }
    }
    expect(isValidCard(fixed)).toBe(true);
    expect(isValidCard({ nums: fixed.nums.map((n) => (n === 90 ? 91 : n)) })).toBe(false);
  });
});

describe('padrões', () => {
  it('tamanhos das máscaras', () => {
    expect(popcount(MASKS.cantos[0])).toBe(5);
    expect(popcount(MASKS.piramide[0])).toBe(9);
    expect(popcount(MASKS.u[0])).toBe(9);
    expect(popcount(MASKS.moldura[0])).toBe(12);
    expect(popcount(MASKS.bingo[0])).toBe(15);
    expect(MASKS.linha.every((x) => popcount(x) === 5)).toBe(true);
    expect(MASKS.linhaDupla.every((x) => popcount(x) === 10)).toBe(true);
  });
  it('detecta cada padrão e só o maior (variado)', () => {
    setPatternSet('variado');
    expect(bestPattern(0)).toBeNull();
    expect(bestPattern(MASKS.linha[1])).toBe('linha');
    expect(bestPattern(MASKS.cantos[0])).toBe('cantos');
    expect(bestPattern(MASKS.piramide[0])).toBe('piramide');
    expect(bestPattern(MASKS.u[0])).toBe('u');
    expect(bestPattern(MASKS.linhaDupla[2])).toBe('linhaDupla');
    expect(bestPattern(MASKS.moldura[0])).toBe('moldura');
    expect(bestPattern(0x7fff)).toBe('bingo');
  });
  it('classico: só linha, linha dupla e bingo contam', () => {
    expect(activePatterns()).toEqual(['linha', 'linhaDupla', 'bingo']);
    expect(bestPattern(MASKS.cantos[0])).toBeNull();
    expect(bestPattern(MASKS.moldura[0])).toBe('linhaDupla');
    expect(bestPattern(MASKS.linha[1])).toBe('linha');
    expect(bestPattern(0x7fff)).toBe('bingo');
    expect(prizeFor('moldura', 5)).toBe(0);
    expect(bestReachableByOne(MASKS.moldura[0] & ~1)).toBe('linhaDupla');
  });
  it('missing e alcançável por 1 (variado)', () => {
    setPatternSet('variado');
    const almost = MASKS.moldura[0] & ~1;
    expect(missing(almost, 'moldura')).toBe(1);
    expect(bestReachableByOne(almost)).toBe('moldura');
  });
});

describe('prêmios e bola extra', () => {
  it('multiplicadores', () => {
    expect(prizeFor('linha', 5)).toBe(25);
    expect(prizeFor('linhaDupla', 2)).toBe(50);
    expect(prizeFor('bingo', 2)).toBe(1000);
    expect(prizeFor(null, 5)).toBe(0);
    expect(prizeFor('cantos', 5)).toBe(0); // fora do conjunto classico
    setPatternSet('variado');
    expect(prizeFor('cantos', 5)).toBe(15);
  });
  it('prizeTable lista só os padrões ativos', () => {
    expect(prizeTable(5)).toEqual([
      { pattern: 'linha', prize: 25 },
      { pattern: 'linhaDupla', prize: 125 },
      { pattern: 'bingo', prize: 2500 },
    ]);
    setPatternSet('variado');
    expect(prizeTable(1)).toHaveLength(7);
  });
  it('jackpotPayout 50/75/100%', () => {
    expect(jackpotPayout(5000, 1)).toBe(2500);
    expect(jackpotPayout(5000, 2)).toBe(3750);
    expect(jackpotPayout(5000, 3)).toBe(5000);
    expect(jackpotPayout(5000.9, 10)).toBe(5000);
  });
  it('arredonda custo', () => {
    expect(niceRound(0.4)).toBe(1);
    expect(niceRound(37)).toBe(50);
    expect(niceRound(14)).toBe(10);
  });
  it('sem chance de melhora não há oferta', () => {
    expect(extraCost([fixed], [true], new Set(), 5)).toBe(0);
  });
  it('oferta existe a 1 número e custo é positivo', () => {
    const drawn = new Set(fixed.nums.filter((_, i) => (MASKS.linha[0] & (1 << i)) !== 0 && i !== 0));
    expect(extraCost([fixed], [true], drawn, 5)).toBeGreaterThan(0);
  });
  it('costFactor barato reduz o custo e o padrão é 0,08', () => {
    const drawn = new Set(fixed.nums.filter((_, i) => (MASKS.linha[0] & (1 << i)) !== 0 && i !== 0));
    const normal = extraCost([fixed], [true], drawn, 10);
    const barata = extraCost([fixed], [true], drawn, 10, 0.04);
    expect(extraCost([fixed], [true], drawn, 10, 0.08)).toBe(normal);
    expect(barata).toBeGreaterThan(0);
    expect(barata).toBeLessThan(normal);
    const mk = (cf?: number) => {
      const s = new RoundSession([fixed], [true], 10, 5000, planFrom([...drawn]), 0, cf);
      for (let i = 0; i < drawn.size; i++) s.nextMain();
      return s.offer();
    };
    expect(mk()!.cost).toBe(normal);
    expect(mk(0.04)!.cost).toBe(barata);
  });
});

function planFrom(order: number[], free?: boolean[]): DrawPlan {
  const rest = Array.from({ length: 90 }, (_, i) => i + 1).filter((n) => !order.includes(n));
  const all = [...order, ...rest];
  return { main: all.slice(0, 30), extras: all.slice(30, 39), free };
}

describe('rodada', () => {
  it.each([
    [1, 2500, 500 + 2500],
    [2, 3750, 1000 + 3750],
    [3, 5000, 1500 + 5000],
    [10, 5000, 5000 + 5000],
  ])('aposta %i: bingo até a 30ª paga acumulado parcial + ×500', (bet, jp, total) => {
    const r = playRound([fixed], [true], bet, 5000, planFrom([...fixed.nums]));
    expect(r.summary.results[0].pattern).toBe('bingo');
    expect(r.summary.jackpot).toBe(jp);
    expect(r.summary.prize).toBe(total);
  });
  it('bingo na extra paga só ×500', () => {
    const nums = [...fixed.nums];
    const last = nums.pop()!;
    const filler = Array.from({ length: 90 }, (_, i) => i + 1).filter((n) => !fixed.nums.includes(n));
    const main = [...nums, ...filler.slice(0, 30 - nums.length)];
    const plan: DrawPlan = { main, extras: [last, ...filler.slice(30 - nums.length, 38 - nums.length)] };
    const r = playRound([fixed], [true], 2, 5000, plan);
    expect(r.summary.results[0].pattern).toBe('bingo');
    expect(r.summary.jackpot).toBe(0);
    expect(r.summary.prize).toBe(1000);
    expect(r.bingoOnExtra).toBe(true);
    expect(r.summary.extrasUsed).toBe(1);
    expect(r.summary.extraCost).toBeGreaterThan(0);
  });
  it('cartela inativa não paga nem conta aposta', () => {
    const plan = planFrom([...fixed.nums]);
    const s = new RoundSession([fixed, fixed], [true, false], 5, 5000, plan);
    expect(s.totalBet).toBe(5);
    while (s.nextMain());
    expect(s.finish().results[1].prize).toBe(0);
  });
  it('limita a 9 bolas extras', () => {
    // 14 números de uma linha+: cartela sempre "falta 1" mais adiante; extras irrelevantes
    const miss = fixed.nums.slice(0, 14);
    const filler = Array.from({ length: 90 }, (_, i) => i + 1).filter((n) => !fixed.nums.includes(n));
    const plan: DrawPlan = { main: [...miss, ...filler.slice(0, 16)], extras: filler.slice(16, 26) };
    const s = new RoundSession([fixed], [true], 1, 5000, plan);
    while (s.nextMain());
    let n = 0;
    while (s.buyExtra()) n++;
    expect(n).toBe(9);
    expect(s.offer()).toBeNull();
  });
  it('extra grátis não debita e é contada', () => {
    const miss = fixed.nums.slice(0, 14);
    const filler = Array.from({ length: 90 }, (_, i) => i + 1).filter((n) => !fixed.nums.includes(n));
    const plan: DrawPlan = {
      main: [...miss, ...filler.slice(0, 16)],
      extras: filler.slice(16, 25),
      free: [true, false],
    };
    const s = new RoundSession([fixed], [true], 5, 5000, plan);
    while (s.nextMain());
    const o1 = s.offer()!;
    expect(o1.free).toBe(true);
    expect(o1.cost).toBe(0);
    expect(o1.improves[0].pattern).toBe('bingo');
    expect(s.offerCost()).toBe(0);
    const b1 = s.buyExtra()!;
    expect(b1.free).toBe(true);
    expect(s.extraSpent).toBe(0);
    const o2 = s.offer()!;
    expect(o2.free).toBe(false);
    expect(o2.cost).toBeGreaterThan(0);
    expect(o2.remaining).toBe(8);
    const c = s.buyExtra()!.cost;
    expect(s.extraSpent).toBe(c);
    const sum = s.finish();
    expect(sum.freeExtras).toBe(1);
    expect(sum.extraCost).toBe(c);
  });
  it('restaura extraSpent', () => {
    const plan = planFrom([...fixed.nums]);
    const s = new RoundSession([fixed], [true], 5, 5000, plan, 7);
    expect(s.extraSpent).toBe(7);
    expect(s.restore(12).extraSpent).toBe(12);
  });
  it('fromSaved reconstrói o estado', () => {
    const plan = planFrom([...fixed.nums.slice(0, 14)]);
    const s = RoundSession.fromSaved({
      extraSpent: 9, bet: 5, jackpot: 5000, plan, mainIdx: 30, extrasUsed: 0, cards: [fixed, fixed, fixed, fixed], active: [true, false, false, false],
    });
    expect(s.mainIdx).toBe(30);
    expect(s.extraSpent).toBe(9);
    expect(s.offer()).not.toBeNull();
  });
});

describe('markedMask', () => {
  it('marca somente sorteados', () => {
    expect(markedMask(fixed, new Set([1, 90]))).toBe(1 | (1 << 14));
  });
});
