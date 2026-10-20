import { describe, it, expect } from 'vitest';
import { generateCard, generateCards, isValidCard, markedMask } from '../src/cards';
import { MASKS, bestPattern, missing, popcount, bestReachableByOne } from '../src/patterns';
import { prizeFor, extraCost, niceRound } from '../src/payout';
import { RoundSession, playRound } from '../src/round';
import { seededRng } from '../src/rng';
import type { Card, DrawPlan } from '../src/types';

const rng = seededRng(42);
const fixed: Card = { nums: [1, 14, 27, 40, 53, 5, 18, 30, 44, 57, 9, 22, 35, 48, 60] };

describe('cartelas', () => {
  it('gera cartelas válidas', () => {
    for (let i = 0; i < 500; i++) expect(isValidCard(generateCard(rng))).toBe(true);
  });
  it('gera 4 cartelas', () => expect(generateCards(rng)).toHaveLength(4));
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
  it('detecta cada padrão e só o maior', () => {
    expect(bestPattern(0)).toBeNull();
    expect(bestPattern(MASKS.linha[1])).toBe('linha');
    expect(bestPattern(MASKS.cantos[0])).toBe('cantos');
    expect(bestPattern(MASKS.piramide[0])).toBe('piramide');
    expect(bestPattern(MASKS.u[0])).toBe('u');
    expect(bestPattern(MASKS.linhaDupla[2])).toBe('linhaDupla');
    expect(bestPattern(MASKS.moldura[0])).toBe('moldura');
    expect(bestPattern(0x7fff)).toBe('bingo');
  });
  it('missing e alcançável por 1', () => {
    const almost = MASKS.moldura[0] & ~1;
    expect(missing(almost, 'moldura')).toBe(1);
    expect(bestReachableByOne(almost)).toBe('moldura');
  });
});

describe('prêmios e bola extra', () => {
  it('multiplicadores', () => {
    expect(prizeFor('linha', 5)).toBe(10);
    expect(prizeFor('bingo', 2)).toBe(600);
    expect(prizeFor(null, 5)).toBe(0);
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
});

function planFrom(cards: Card, order: number[]): DrawPlan {
  const rest = Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => !order.includes(n));
  const all = [...order, ...rest];
  return { main: all.slice(0, 30), extras: all.slice(30, 40) };
}

describe('rodada', () => {
  it('bingo até a 30ª bola paga acumulado + ×300', () => {
    const others = [...fixed.nums];
    const plan = planFrom(fixed, others);
    const r = playRound([fixed], [true], 1, 5000, plan);
    expect(r.summary.results[0].pattern).toBe('bingo');
    expect(r.summary.jackpot).toBe(5000);
    expect(r.summary.prize).toBe(5300);
  });
  it('bingo na extra paga só ×300', () => {
    const nums = [...fixed.nums];
    const last = nums.pop()!;
    const filler = Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => !fixed.nums.includes(n));
    const main = [...nums, ...filler.slice(0, 30 - nums.length)];
    const plan: DrawPlan = { main, extras: [last, ...filler.slice(30 - nums.length, 39 - nums.length)] };
    const r = playRound([fixed], [true], 2, 5000, plan);
    expect(r.summary.results[0].pattern).toBe('bingo');
    expect(r.summary.jackpot).toBe(0);
    expect(r.summary.prize).toBe(600);
    expect(r.bingoOnExtra).toBe(true);
    expect(r.summary.extrasUsed).toBe(1);
  });
  it('cartela inativa não paga nem conta aposta', () => {
    const plan = planFrom(fixed, [...fixed.nums]);
    const s = new RoundSession([fixed, fixed], [true, false], 5, 5000, plan);
    expect(s.totalBet).toBe(5);
    while (s.nextMain());
    expect(s.finish().results[1].prize).toBe(0);
  });
  it('limita a 10 bolas extras', () => {
    const plan = planFrom(fixed, []);
    const s = new RoundSession([fixed], [true], 1, 5000, plan);
    while (s.nextMain());
    let n = 0;
    while (s.buyExtra()) n++;
    expect(n).toBeLessThanOrEqual(10);
  });
});

describe('markedMask', () => {
  it('marca somente sorteados', () => {
    expect(markedMask(fixed, new Set([1, 60]))).toBe(1 | (1 << 14));
  });
});
