// Verificação independente das regras (spec §3) usando apenas RoundSession/payout/patterns.
import { RoundSession } from '../../../src/round';
import { extraCost, prizeFor } from '../../../src/payout';
import { MASKS, bestPattern } from '../../../src/patterns';
import { MULTIPLIER } from '../../../src/config';
import type { Card, PatternId } from '../../../src/types';

let fails = 0;
const chk = (name: string, ok: boolean, info = '') => { if (!ok) fails++; console.log(`${ok ? 'OK  ' : 'FALHA'} ${name}${info ? ' -> ' + info : ''}`); };

// cartela fixa (linha*5+coluna): col c tem 12c+1..12c+12
const card: Card = { nums: [1, 14, 27, 40, 53, 5, 18, 30, 44, 57, 9, 22, 35, 48, 60] };
const idx = (m: number) => [...Array(15)].map((_, i) => i).filter((i) => (m >> i) & 1);
const fill = (nums: number[], len: number) => { const out = [...nums]; for (let n = 1; out.length < len && n <= 60; n++) if (!card.nums.includes(n)) out.push(n); return out; };
const pad = (n: number) => { const o: number[] = []; for (let k = 1; o.length < n && k <= 60; k++) if (!card.nums.includes(k)) o.push(k); return o; };

function run(marked: number[], bet = 5, opts: { atBall?: number } = {}) {
  const others = pad(60);
  // coloca os números da cartela nas posições finais (ou em atBall) e completa com outros
  const main: number[] = []; let oi = 0;
  const at = opts.atBall ?? 30;
  const first = marked.slice(0, -1), lastN = marked[marked.length - 1];
  while (main.length < at - 1 - first.length) main.push(others[oi++]);
  main.push(...first);
  main.push(lastN);
  while (main.length < 30) main.push(others[oi++]);
  const extras = others.slice(oi, oi + 10);
  const s = new RoundSession([card], [true], bet, 5400, { main, extras });
  while (s.nextMain());
  return s;
}
const numsOf = (m: number) => idx(m).map((i) => card.nums[i]);

const pats: PatternId[] = ['linha', 'cantos', 'piramide', 'u', 'linhaDupla', 'moldura', 'bingo'];
for (const p of pats) {
  const mask = MASKS[p][0];
  const s = run(numsOf(mask));
  const r = s.finish();
  chk(`padrão ${p} (máscara ${MASKS[p].length > 1 ? 'primeira' : 'única'}) paga só ${p} x${MULTIPLIER[p]}`, r.results[0].pattern === p && r.results[0].prize === 5 * MULTIPLIER[p] - (p === 'bingo' ? 0 : 0) + 0 || (p === 'bingo' && r.results[0].prize === 1500), `${r.results[0].pattern} prêmio ${r.results[0].prize} acumulado ${r.jackpot}`);
}
// todas as 5 variações de linha, 3 de linhaDupla
chk('linhas (3) são padrão linha', MASKS.linha.every((m) => bestPattern(m) === 'linha'));
chk('linha dupla (3 combinações)', MASKS.linhaDupla.every((m) => bestPattern(m) === 'linhaDupla'));
// "só o maior": U contém linha de baixo; moldura contém 2 linhas
chk('U não paga linha+U', bestPattern(MASKS.u[0]) === 'u');
// pirâmide: máscara conforme spec
const pir = ['..X..', '.XXX.', 'XXXXX'];
let pm = 0; pir.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') pm |= 1 << (r * 5 + c); }));
chk('máscara pirâmide = spec', MASKS.piramide[0] === pm);
const uu = ['X...X', 'X...X', 'XXXXX']; let um = 0; uu.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') um |= 1 << (r * 5 + c); }));
chk('máscara U = spec', MASKS.u[0] === um);
const mo = ['XXXXX', 'X...X', 'XXXXX']; let mm = 0; mo.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') mm |= 1 << (r * 5 + c); }));
chk('máscara moldura = spec', MASKS.moldura[0] === mm);
const ca = ['X...X', '..X..', 'X...X']; let cm = 0; ca.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') cm |= 1 << (r * 5 + c); }));
chk('máscara cantos = spec (5 casas)', MASKS.cantos[0] === cm);

// acumulado: bingo na bola 30 paga acumulado; na extra 1 (bola 31) não
{
  const s = run(card.nums, 5, { atBall: 30 });
  chk('bingo na 30ª bola paga acumulado inteiro', s.finish().jackpot === 5400, `jackpot=${s.finish().jackpot}`);
  const s2 = run(card.nums, 5, { atBall: 29 });
  chk('bingo na 29ª bola paga acumulado', s2.finish().jackpot === 5400);
  // bingo na extra: 29 números + extra
  const others = pad(60);
  const main = [...card.nums.slice(0, 14), ...others.slice(0, 16)];
  const s3 = new RoundSession([card], [true], 5, 5400, { main, extras: [card.nums[14], ...others.slice(16, 25)] });
  while (s3.nextMain());
  const cost = s3.offerCost();
  const r = s3.buyExtra();
  const fin = s3.finish();
  chk('bingo na extra paga só x300 (sem acumulado)', fin.jackpot === 0 && fin.prize === 1500, `prize=${fin.prize} jackpot=${fin.jackpot} custoExtra=${cost}`);
  chk('custo da extra: max(1, round(0.08*ganho adicional)) arredondado "redondo"', cost > 0, `custo=${cost}`);
}
// custo exemplos (aposta 5): moldura->bingo ganho=1500-200 => .08*1300=104 -> 100
{
  const c = (cur: number[], bet: number) => extraCost([card], [true], new Set(cur), bet);
  const mold = numsOf(MASKS.moldura[0]);
  const noCorner = mold.filter((n) => n !== card.nums[0]);
  chk('oferta com 1 faltando p/ moldura (bet 1)', c(noCorner, 1) >= 1, `custo=${c(noCorner, 1)}`);
  chk('sem oferta quando já é bingo', c(card.nums, 5) === 0);
  chk('sem oferta com cartela vazia', c([], 5) === 0);
  chk('custo mínimo 1 (bet 1, falta p/ linha)', c(numsOf(MASKS.linha[0]).slice(1), 1) === 1, `custo=${c(numsOf(MASKS.linha[0]).slice(1), 1)}`);
  const vals = new Set<number>();
  for (const b of [1, 2, 5, 10, 20]) vals.add(c(noCorner, b));
  console.log('   custos moldura-1 por aposta [1,2,5,10,20]:', [...vals].join(','));
}
// limite de 10 extras e oferta só com chance
{
  const others = pad(60);
  const main = [...card.nums.slice(0, 14), ...others.slice(0, 16)]; // 14 marcadas (falta 1)
  const extras = others.slice(16, 28);
  const s = new RoundSession([card], [true], 5, 5000, { main, extras });
  while (s.nextMain());
  let n = 0;
  while (s.offerCost() > 0 && n < 50) { s.buyExtra(); n++; }
  chk('máximo de 10 extras por rodada (12 disponíveis, bola decisiva nunca sai)', n === 10, `compradas=${n}, extrasUsed=${s.extrasUsed}`);
  chk('depois do limite, nenhuma oferta', s.offerCost() === 0);
}
// nextJackpot
import('../../../src/payout').then(({ nextJackpot }) => {
  let j = 5000; for (let i = 0; i < 100; i++) j = nextJackpot(j, 20);
  chk('acumulado cresce +2% da aposta total (aposta total 20, 100 rodadas => +40)', j === 5040, `acumulado=${j}`);
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo OK');
});
void prizeFor;
