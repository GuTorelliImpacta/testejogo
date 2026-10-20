import { describe, it, expect } from 'vitest';
import { migrate, freshSave } from '../src/storage';
import { isValidCard } from '../src/cards';
import { DEFAULT_SETTINGS, DEFAULT_TUNING } from '../src/config';

const NOW = Date.UTC(2026, 9, 20);

const v1 = () => ({
  version: 1,
  credits: 4321,
  bet: 20,
  cards: Array.from({ length: 4 }, () => ({ nums: [1, 13, 25, 37, 49, 2, 14, 26, 38, 50, 3, 15, 27, 39, 51] })),
  active: [true, true, false, true],
  jackpot: 7123.45,
  settings: { speed: 'rapida', volMusic: 0.2, muted: true },
  director: {
    ultimoBingoEm: 111,
    bingosPorMes: { '2026-10': 2 },
    rodadasDesdeUltimoBingo: 9,
    primeiroUsoEm: 5,
    historicoBingos: [100, 111],
  },
  stats: { rodadas: 77, apostado: 10, ganho: 8, apostadoTotal: 12, ganhoTotal: 9, rodadasPorDia: { '2026-10-19': 5 }, recargas: 2, porPadrao: { linha: 4 } },
  lastDailyBonus: '2026-10-19',
  round: { bet: 5, jackpot: 5000, plan: { main: [], extras: [] }, mainIdx: 3, extrasUsed: 0, cards: [], active: [true] },
});

describe('migração v1 -> v3', () => {
  it('preserva saldo, acumulado, diretor, stats e configurações', () => {
    const m = migrate(v1(), NOW)!;
    expect(m.version).toBe(3);
    expect(m.credits).toBe(4321);
    expect(m.jackpot).toBeCloseTo(7123.45);
    expect(m.director.historicoBingos).toEqual([100, 111]);
    expect(m.director.ultimoBingoEm).toBe(111);
    expect(m.director.bingosPorMes).toEqual({ '2026-10': 2 });
    expect(m.stats.rodadas).toBe(77);
    expect(m.stats.porPadrao).toEqual({ linha: 4 });
    expect(m.lastDailyBonus).toBe('2026-10-19');
    expect(m.settings.speed).toBe('rapida');
    expect(m.settings.muted).toBe(true);
    expect(m.settings.turbo).toBe(DEFAULT_SETTINGS.turbo);
    expect(m.settings.bordoes).toBe(true);
  });
  it('descarta rodada, gera cartelas 1–90 e converte aposta', () => {
    const m = migrate(v1(), NOW)!;
    expect(m.round).toBeNull();
    expect(m.bet).toBe(10);
    expect(m.cards).toHaveLength(4);
    expect(m.cards.every(isValidCard)).toBe(true);
    expect(m.mail).toEqual({ day: '', bonusToday: 0, playMs: 0, pending: null });
    expect(m.turboRounds).toBe(0);
  });
  it('apostas v1 válidas', () => {
    for (const [b, e] of [[1, 1], [2, 2], [5, 5], [10, 10], [20, 10]]) {
      expect(migrate({ ...v1(), bet: b }, NOW)!.bet).toBe(e);
    }
  });
});

describe('save v3', () => {
  it('aceita um save v3 válido e preserva tudo', () => {
    const f = freshSave(NOW);
    f.credits = 999;
    f.bet = 7;
    f.mail = { day: '2026-10-20', bonusToday: 1, playMs: 5000, pending: { kind: 'bonus', amount: 40 } };
    f.turboRounds = 4;
    const m = migrate(JSON.parse(JSON.stringify(f)), NOW)!;
    expect(m).toEqual(f);
  });
  it('rejeita versões desconhecidas e lixo', () => {
    expect(migrate({ version: 4 }, NOW)).toBeNull();
    expect(migrate({ version: 0 }, NOW)).toBeNull();
    expect(migrate(null, NOW)).toBeNull();
  });
  it('corrige aposta e cartelas inválidas', () => {
    const f: any = JSON.parse(JSON.stringify(freshSave(NOW)));
    f.bet = 20;
    f.cards[0].nums[0] = 91;
    const m = migrate(f, NOW)!;
    expect(m.bet).toBe(5);
    expect(m.cards.every(isValidCard)).toBe(true);
  });
  it('valida rodada em andamento (1–90, 9 extras, extraSpent)', () => {
    const f: any = JSON.parse(JSON.stringify(freshSave(NOW)));
    const all = Array.from({ length: 90 }, (_, i) => i + 1);
    f.round = {
      extraSpent: 6, bet: 5, jackpot: 5000,
      plan: { main: all.slice(0, 30), extras: all.slice(30, 39), free: [true] },
      mainIdx: 30, extrasUsed: 1, cards: f.cards, active: [true, true, true, true],
    };
    expect(migrate(f, NOW)!.round).not.toBeNull();
    const bad = (mut: (r: any) => void) => {
      const g = JSON.parse(JSON.stringify(f));
      mut(g.round);
      return migrate(g, NOW)!.round;
    };
    expect(bad((r) => delete r.extraSpent)).toBeNull();
    expect(bad((r) => (r.plan.extras = all.slice(30, 40)))).toBeNull();
    expect(bad((r) => (r.plan.main[0] = 91))).toBeNull();
    expect(bad((r) => (r.bet = 20))).toBeNull();
  });
});

describe('migração v2 -> v3', () => {
  const v2 = () => {
    const f: any = JSON.parse(JSON.stringify(freshSave(NOW)));
    delete f.tuning;
    delete f.adminPin;
    f.version = 2;
    f.credits = 777;
    f.jackpot = 6543.21;
    f.lastDailyBonus = '2026-10-19';
    f.settings.speed = 'lenta';
    f.director = { ultimoBingoEm: 222, bingosPorMes: { '2026-10': 1 }, rodadasDesdeUltimoBingo: 4, primeiroUsoEm: 9, historicoBingos: [222] };
    f.stats.rodadas = 31;
    f.stats.recargas = 3;
    f.mail = { day: '2026-10-20', bonusToday: 1, playMs: 1234, pending: { kind: 'daily', amount: 300 } };
    const all = Array.from({ length: 90 }, (_, i) => i + 1);
    f.round = {
      extraSpent: 6, bet: 5, jackpot: 5000,
      plan: { main: all.slice(0, 30), extras: all.slice(30, 39), free: [true] },
      mainIdx: 12, extrasUsed: 0, cards: f.cards, active: [true, true, false, true],
    };
    return f;
  };
  it('preserva tudo, inclusive a rodada em andamento, e põe tuning padrão', () => {
    const src = v2();
    const m = migrate(JSON.parse(JSON.stringify(src)), NOW)!;
    expect(m.version).toBe(3);
    expect(m.credits).toBe(777);
    expect(m.jackpot).toBeCloseTo(6543.21);
    expect(m.settings.speed).toBe('lenta');
    expect(m.director).toEqual(src.director);
    expect(m.stats.rodadas).toBe(31);
    expect(m.stats.recargas).toBe(3);
    expect(m.mail).toEqual(src.mail);
    expect(m.lastDailyBonus).toBe('2026-10-19');
    expect(m.round).toEqual(src.round);
    expect(m.cards).toEqual(src.cards);
    expect(m.tuning).toEqual(DEFAULT_TUNING);
    expect(m.adminPin).toBeNull();
  });
  it('v1 continua descartando a rodada', () => {
    expect(migrate(v1(), NOW)!.round).toBeNull();
  });
  it('valida tuning e adminPin estritamente', () => {
    const f = v2();
    f.version = 3;
    f.tuning = { bingosPorMes: '9', premiosDoDia: 'mais', ofertaExtra: 5, chanceGratis: 'menos', custoExtra: 'barata', presente: 700, correioDiario: 500, conjuntoPadroes: 'variado' };
    f.adminPin = '12a4';
    const m = migrate(f, NOW)!;
    expect(m.tuning).toEqual({ ...DEFAULT_TUNING, premiosDoDia: 'mais', chanceGratis: 'menos', custoExtra: 'barata', correioDiario: 500, conjuntoPadroes: 'variado' });
    expect(m.adminPin).toBeNull();
    f.adminPin = '4321';
    expect(migrate(f, NOW)!.adminPin).toBe('4321');
    f.tuning = 'lixo';
    expect(migrate(f, NOW)!.tuning).toEqual(DEFAULT_TUNING);
  });
});
