// Fixtures do QA: monta saves artificiais (rodada em andamento, saldo baixo...) para forçar estados.
import { freshSave } from '../../../src/storage';
import { generateCards } from '../../../src/cards';
import { seededRng } from '../../../src/rng';
import type { SaveData } from '../../../src/types';

export const KEY = 'altina-da-sorte:v1';
export const BASE = process.env.QA_BASE ?? 'http://localhost:4180';
export const EXE = '/opt/pw-browsers/chromium';
export const VIEWPORTS = [
  { w: 1280, h: 800 },
  { w: 800, h: 1280 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 360, h: 740 },
];

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function baseSave(seed = 1): SaveData {
  const s = freshSave(Date.now());
  s.cards = generateCards(seededRng(seed));
  s.lastDailyBonus = today();
  return s;
}

/** Rodada parada com a cartela 0 a 1 número do BINGO. `mainIdx`=30 -> oferta de bola extra. */
export function roundNearBingo(mainIdx: number, extrasUsed = 0, jackpot = 5400): SaveData {
  const s = baseSave(3);
  const c0 = s.cards[0].nums;
  const last = c0[14];
  const others: number[] = [];
  for (let n = 1; n <= 60 && others.length < 40; n++) if (!c0.includes(n)) others.push(n);
  const main = [...c0.slice(0, 14), ...others.slice(0, 15), last]; // 14 + 15 + 1 = 30; a decisiva é a 30ª
  const extras = [...others.slice(15, 25)];
  s.round = {
    bet: 5,
    jackpot,
    plan: { main, extras },
    mainIdx,
    extrasUsed,
    cards: s.cards,
    active: [true, true, true, true],
  };
  s.credits = 800;
  return s;
}

/** Cartela 0 a 1 número do bingo só depois de 30 bolas; a 31ª (extra 1) é a decisiva. */
export function roundBingoOnExtra(mainIdx = 30): SaveData {
  const s = baseSave(4);
  const c0 = s.cards[0].nums;
  const last = c0[14];
  const others: number[] = [];
  for (let n = 1; n <= 60 && others.length < 40; n++) if (!c0.includes(n)) others.push(n);
  const main = [...c0.slice(0, 14), ...others.slice(0, 16)];
  const extras = [last, ...others.slice(16, 25)];
  s.round = { bet: 5, jackpot: 5400, plan: { main, extras }, mainIdx, extrasUsed: 0, cards: s.cards, active: [true, true, true, true] };
  s.credits = 800;
  return s;
}
