import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGame, handleResetPinParam } from '../src/game';
import { freshSave } from '../src/storage';
import { ADMIN_PIN, DEFAULT_TUNING, activePatterns, setPatternSet } from '../src/config';
import type { GameApi } from '../src/gameApi';
import type { SaveData } from '../src/types';

const NOW = Date.UTC(2026, 9, 20, 15);
const audio = {
  unlock() {},
  greet() {},
  waitForSpeech: () => Promise.resolve(),
  setFast() {},
  setMode() {},
  setVolumes() {},
};

let store: Record<string, string>;
beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  });
  setPatternSet('classico');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setPatternSet('classico');
});

function seed(patch: (d: SaveData) => void): void {
  const d = freshSave(NOW);
  d.lastDailyBonus = '2026-10-20';
  patch(d);
  store['altina-da-sorte:v3'] = JSON.stringify(d);
}
const make = (): GameApi => createGame(audio, () => NOW);
const stored = (): SaveData => JSON.parse(store['altina-da-sorte:v3']);

describe('PIN', () => {
  it('padrão destrava; errado não; tudo bloqueado sem unlock', () => {
    const g = make();
    expect(g.admin.stats()).toBeNull();
    expect(g.admin.device()).toBeNull();
    expect(g.admin.exportJson()).toBe('');
    expect(g.admin.unlock('0000')).toBe(false);
    expect(g.admin.unlock(ADMIN_PIN)).toBe(true);
    expect(g.admin.stats()).not.toBeNull();
    g.admin.lock();
    expect(g.admin.stats()).toBeNull();
  });
  it('trocar PIN: novo vale, antigo não, persiste', () => {
    const g = make();
    g.admin.unlock(ADMIN_PIN);
    expect(g.admin.changePin('9999', '1234')).toBe(false);
    expect(g.admin.changePin(ADMIN_PIN, '12')).toBe(false);
    expect(g.admin.changePin(ADMIN_PIN, 'abcd')).toBe(false);
    expect(g.admin.changePin(ADMIN_PIN, '1234')).toBe(true);
    expect(stored().adminPin).toBe('1234');
    g.admin.lock();
    expect(g.admin.unlock(ADMIN_PIN)).toBe(false);
    expect(g.admin.unlock('1234')).toBe(true);
    expect(make().admin.unlock('1234')).toBe(true); // recarregado do disco
  });
  it('changePin exige unlock', () => {
    const g = make();
    expect(g.admin.changePin(ADMIN_PIN, '1234')).toBe(false);
  });
  it('resetPin só com o PIN padrão e volta adminPin a null', () => {
    seed((d) => {
      d.adminPin = '4321';
    });
    const g = make();
    expect(g.admin.unlock(ADMIN_PIN)).toBe(false);
    expect(g.admin.resetPin('4321')).toBe(false);
    expect(g.admin.resetPin('0000')).toBe(false);
    expect(g.admin.resetPin(ADMIN_PIN)).toBe(true);
    expect(stored().adminPin).toBeNull();
    expect(g.admin.unlock('4321')).toBe(false);
    expect(g.admin.unlock(ADMIN_PIN)).toBe(true);
  });
  it('handleResetPinParam', () => {
    seed((d) => {
      d.adminPin = '4321';
    });
    const g = make();
    expect(handleResetPinParam(g, '', () => ADMIN_PIN)).toBe(false);
    expect(handleResetPinParam(g, '?x=1', () => ADMIN_PIN)).toBe(false);
    expect(handleResetPinParam(g, '?resetpin=1', () => null)).toBe(false);
    expect(handleResetPinParam(g, '?resetpin=1', () => '1111')).toBe(false);
    expect(stored().adminPin).toBe('4321');
    expect(handleResetPinParam(g, '?a=2&resetpin=1', () => ADMIN_PIN)).toBe(true);
    expect(stored().adminPin).toBeNull();
  });
});

describe('tuning', () => {
  it('setTuning ignora inválidos e persiste os válidos; resetTuning restaura', () => {
    const g = make();
    g.admin.setTuning({ presente: 2000 }); // bloqueado
    g.admin.unlock(ADMIN_PIN);
    expect(g.admin.getTuning()).toEqual(DEFAULT_TUNING);
    g.admin.setTuning({ presente: 123 as any, custoExtra: 'barata', bingosPorMes: '9' as any, nada: 1 } as any);
    expect(g.admin.getTuning()).toEqual({ ...DEFAULT_TUNING, custoExtra: 'barata' });
    g.admin.setTuning({ presente: 2000, correioDiario: 500, bingosPorMes: '3-4' });
    expect(stored().tuning).toEqual({ ...DEFAULT_TUNING, custoExtra: 'barata', presente: 2000, correioDiario: 500, bingosPorMes: '3-4' });
    g.admin.resetTuning();
    expect(g.admin.getTuning()).toEqual(DEFAULT_TUNING);
    expect(stored().tuning).toEqual(DEFAULT_TUNING);
  });
  it('setPatternSet e conjuntoPadroes andam juntos; chave antiga é migrada', () => {
    store['altina-da-sorte:patternSet'] = 'variado';
    const g = make();
    expect(activePatterns()).toHaveLength(7);
    expect('altina-da-sorte:patternSet' in store).toBe(false);
    g.admin.unlock(ADMIN_PIN);
    expect(g.admin.getTuning().conjuntoPadroes).toBe('variado');
    g.admin.setPatternSet('classico');
    expect(activePatterns()).toHaveLength(3);
    expect(stored().tuning.conjuntoPadroes).toBe('classico');
  });
  it('export/import preservam tuning e PIN', () => {
    const g = make();
    g.admin.unlock(ADMIN_PIN);
    g.admin.setTuning({ presente: 500, conjuntoPadroes: 'variado' });
    g.admin.changePin(ADMIN_PIN, '2468');
    const json = g.admin.exportJson();
    expect(JSON.parse(json).adminPin).toBe('2468');
    expect(JSON.parse(json).tuning.presente).toBe(500);
    store = {};
    setPatternSet('classico');
    const h = make();
    h.admin.unlock(ADMIN_PIN);
    expect(h.admin.importJson('lixo')).toBe(false);
    expect(h.admin.importJson(json)).toBe(true);
    expect(h.admin.getTuning().presente).toBe(500);
    expect(activePatterns()).toHaveLength(7);
    h.admin.lock();
    expect(h.admin.unlock(ADMIN_PIN)).toBe(false);
    expect(h.admin.unlock('2468')).toBe(true);
  });
  it('correio diário usa tuning.correioDiario', () => {
    seed((d) => {
      d.lastDailyBonus = '';
      d.tuning = { ...DEFAULT_TUNING, correioDiario: 500 };
    });
    const g = make();
    g.enter();
    expect(g.getView().mail).toEqual({ kind: 'daily', amount: 500, open: false });
  });
  it('presente usa tuning.presente', () => {
    seed((d) => {
      d.credits = 10;
      d.tuning = { ...DEFAULT_TUNING, presente: 2000 };
    });
    const g = make();
    g.enter();
    g.play();
    const v = g.getView();
    expect(v.phase).toBe('gift');
    expect(v.giftAmount).toBe(2000);
    g.takeGift();
    expect(g.getView().credits).toBe(2010);
  });
  it('mudança no meio da rodada só vale na próxima', async () => {
    const g = make();
    g.enter();
    g.updateSettings({ turbo: true });
    g.play();
    expect(g.getView().phase).toBe('drawing');
    g.admin.unlock(ADMIN_PIN);
    g.admin.setTuning({ conjuntoPadroes: 'variado', presente: 2000 });
    expect(g.admin.getTuning().conjuntoPadroes).toBe('variado');
    expect(activePatterns()).toHaveLength(3); // rodada em curso intacta
    expect(g.getView().prizeTable).toHaveLength(3);
    for (let i = 0; i < 200 && g.getView().phase !== 'idle'; i++) {
      const ph = g.getView().phase;
      if (ph === 'extraOffer') g.finishExtra();
      if (ph === 'celebrating') g.continueCelebration();
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(g.getView().phase).toBe('idle');
    expect(activePatterns()).toHaveLength(7);
    expect(g.getView().prizeTable).toHaveLength(7);
  }, 15000);
  it('stats legíveis', () => {
    seed((d) => {
      d.director.historicoBingos = [Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 15)];
      d.director.ultimoBingoEm = Date.UTC(2026, 9, 15, 15);
      d.director.bingosPorMes = { '2026-10': 2 };
      d.stats.rodadas = 10;
      d.stats.rodadasPorDia = { a: 4, b: 1 };
      d.stats.porPadrao = { linha: 3 };
      d.stats.recargas = 2;
    });
    const g = make();
    g.admin.unlock(ADMIN_PIN);
    const s = g.admin.stats()!;
    expect(s.bingosNoMes).toBe(2);
    expect(s.ultimosBingos).toHaveLength(2);
    expect(s.ultimosBingos[0]).toBe(new Date(Date.UTC(2026, 9, 15)).toLocaleDateString('pt-BR'));
    expect(s.diasDesdeUltimoBingo).toBe(5);
    expect(s.rodadasPorDia).toBe(5);
    expect(s.premiosPorTipo).toEqual({ linha: 3 });
    expect(s.recargas).toBe(2);
    expect(s.tuning).toEqual(DEFAULT_TUNING);
    expect(JSON.stringify(s)).not.toContain(ADMIN_PIN);
  });
});
