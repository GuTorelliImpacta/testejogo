import { bus } from './events';
import {
  ADMIN_PIN,
  BET_OPTIONS,
  DAILY_BONUS,
  GIFT_AMOUNT,
  GIFT_THRESHOLD,
  JACKPOT_BASE,
  SPEED_MS,
  START_CREDITS,
} from './config';
import { generateCards } from './cards';
import { cryptoRng } from './rng';
import { RoundSession, type Step } from './round';
import { nextJackpot, prizeFor } from './payout';
import { levelOf } from './patterns';
import { planRound, afterRound } from './director';
import { load, migrate, save, saveNow, emptyStats } from './storage';
import type { GameApi, GameView } from './gameApi';
import type { GamePhase, RoundSummary, SaveData, Settings } from './types';
import { BALLS_MAIN } from './types';

/** Interface mínima de áudio usada pelo jogo (implementada por src/audio). */
export interface AudioPort {
  unlock(): void;
  greet(hour: number): void;
  waitForSpeech(): Promise<void>;
  setFast(fast: boolean): void;
  setMode(mode: 'calm' | 'lively'): void;
  setVolumes(v: { music: number; voice: number; sfx: number; muted: boolean }): void;
}

const LEVEL_CELEBRATE = levelOf('linhaDupla');

function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createGame(audio: AudioPort, now: () => number = Date.now): GameApi {
  let data: SaveData = load(now());
  let phase: GamePhase = 'splash';
  let session: RoundSession | null = null;
  let drawn: number[] = [];
  let current: number | null = null;
  let summary: RoundSummary | null = null;
  let extraOffer: { cost: number; remaining: number } | null = null;
  let auto = false;
  let fast = false;
  let giftAmount = 0;
  let runId = 0; // invalida laços antigos
  let wake: (() => void) | null = null;
  let unlockedAdmin = false;
  let extraResolver: ((buy: boolean) => void) | null = null;
  let celebrationResolver: (() => void) | null = null;

  const activeCount = () => data.active.filter(Boolean).length;
  const totalBet = () => data.bet * activeCount();
  const changed = () => bus.emit('stateChanged');

  function applyAudioSettings(): void {
    const s = data.settings;
    audio.setVolumes({ music: s.volMusic, voice: s.volVoice, sfx: s.volSfx, muted: s.muted });
  }

  function persist(round = true): void {
    if (round && session && (phase === 'drawing' || phase === 'extraOffer' || phase === 'extraDrawing')) {
      data.round = {
        bet: session.bet,
        jackpot: session.jackpot,
        plan: session.plan,
        mainIdx: session.mainIdx,
        extrasUsed: session.extrasUsed,
        cards: session.cards,
        active: session.active,
      };
    } else {
      data.round = null;
    }
    save(data);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((res) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        wake = null;
        res();
      }
      wake = done;
    });
  }

  function emitStep(step: Step): void {
    drawn.push(step.ball);
    current = step.ball;
    bus.emit('ballDrawn', { ball: step.ball, index: step.index, extra: step.extra, fast });
    for (const a of step.almost) bus.emit('almost', a);
    for (const w of step.won) {
      const prize = prizeFor(w.pattern, session ? session.bet : 0);
      bus.emit('patternWon', { cardIndex: w.cardIndex, pattern: w.pattern, prize, ball: step.ball });
    }
    if (step.bingo) {
      bus.emit('bingo', { cardIndex: step.bingo.cardIndex, viaExtra: step.extra });
      if (!step.extra && session && session.jackpotAmount > 0) {
        bus.emit('jackpot', { amount: session.jackpotAmount });
      }
    }
    changed();
  }

  async function drawLoop(id: number): Promise<void> {
    const s = session!;
    audio.setMode('lively');
    while (!s.mainDone && id === runId) {
      const step = s.nextMain()!;
      emitStep(step);
      persist();
      if (!fast) await audio.waitForSpeech();
      if (id !== runId) return;
      await sleep(fast ? 90 : SPEED_MS[data.settings.speed]);
    }
    if (id !== runId) return;
    await extraLoop(id);
  }

  async function extraLoop(id: number): Promise<void> {
    const s = session!;
    fast = false;
    audio.setFast(false);
    for (;;) {
      if (id !== runId) return;
      const cost = s.offerCost();
      if (!cost) break;
      auto = false; // jogo automático para em qualquer oferta
      phase = 'extraOffer';
      extraOffer = { cost, remaining: 10 - s.extrasUsed };
      bus.emit('extraOffer', extraOffer);
      persist();
      changed();
      const buy = await new Promise<boolean>((res) => (extraResolver = res));
      extraResolver = null;
      if (id !== runId) return;
      extraOffer = null;
      if (!buy) break;
      if (data.credits < cost) giveGift(); // créditos infinitos
      data.credits -= cost;
      phase = 'extraDrawing';
      const r = s.buyExtra();
      if (!r) break;
      bus.emit('extraBought', { cost, number: r.step.ball });
      emitStep(r.step);
      persist();
      await audio.waitForSpeech();
      await sleep(600);
    }
    await settle(id);
  }

  function giveGift(): void {
    data.credits += GIFT_AMOUNT;
    data.stats.recargas++;
    bus.emit('giftCredits', { amount: GIFT_AMOUNT });
  }

  async function settle(id: number): Promise<void> {
    const s = session!;
    phase = 'settling';
    changed();
    const sum = s.finish();
    summary = sum;
    data.credits += sum.prize;
    if (sum.jackpot > 0) data.jackpot = JACKPOT_BASE;
    // estatísticas
    const st = data.stats;
    st.rodadas++;
    st.apostadoTotal += sum.totalBet + sum.extraCost;
    st.ganhoTotal += sum.prize;
    if (!sum.results.some((r) => r.pattern === 'bingo')) {
      st.apostado += sum.totalBet + sum.extraCost;
      st.ganho += sum.prize;
    }
    const dk = dayKey(now());
    st.rodadasPorDia[dk] = (st.rodadasPorDia[dk] ?? 0) + 1;
    for (const r of sum.results) if (r.pattern) st.porPadrao[r.pattern] = (st.porPadrao[r.pattern] ?? 0) + 1;
    const hadBingo = sum.results.some((r) => r.pattern === 'bingo');
    data.director = afterRound(data.director, now(), hadBingo);
    // atualiza prêmios mostrados nos eventos finais
    bus.emit('roundEnd', { summary: sum, won: sum.prize > 0 });
    session = null;
    audio.setMode('calm');
    const big = levelOf(sum.best) >= LEVEL_CELEBRATE;
    if (big) {
      phase = 'celebrating';
      persist(false);
      saveNow(data);
      changed();
      await new Promise<void>((res) => (celebrationResolver = res));
      celebrationResolver = null;
      if (id !== runId) return;
    } else {
      await sleep(sum.prize > 0 ? 1800 : 900);
      if (id !== runId) return;
    }
    phase = 'idle';
    persist(false);
    saveNow(data);
    changed();
    maybeAuto(big);
  }

  function maybeAuto(wasBig: boolean): void {
    if (!auto || wasBig) {
      if (wasBig) auto = false;
      return;
    }
    setTimeout(() => {
      if (auto && phase === 'idle') api.play();
    }, 900);
  }

  function startSession(s: RoundSession): void {
    session = s;
    drawn = [];
    current = null;
    summary = null;
    extraOffer = null;
    fast = false;
    audio.setFast(false);
    const id = ++runId;
    phase = 'drawing';
    changed();
    void drawLoop(id);
  }

  const api: GameApi = {
    getView(): GameView {
      return {
        phase,
        credits: data.credits,
        bet: data.bet,
        totalBet: totalBet(),
        jackpot: data.jackpot,
        cards: data.cards,
        active: data.active,
        drawn,
        current,
        mainCount: Math.min(BALLS_MAIN, session ? session.mainIdx : drawn.filter((_, i) => i < BALLS_MAIN).length),
        extraOffer,
        summary,
        auto,
        settings: data.settings,
        giftAmount,
      };
    },

    enter() {
      if (phase !== 'splash') return;
      audio.unlock();
      applyAudioSettings();
      const t = now();
      const today = dayKey(t);
      if (data.round) {
        // retoma a rodada exatamente de onde parou
        const r = data.round;
        const s = new RoundSession(r.cards, r.active, r.bet, r.jackpot, r.plan);
        for (let i = 0; i < r.mainIdx; i++) emitSilent(s.nextMain()!);
        for (let i = 0; i < r.extrasUsed; i++) {
          // extras já compradas: reaplica sem cobrar de novo
          emitSilent(s.buyExtra()!.step);
        }
        session = s;
        audio.greet(new Date(t).getHours());
        const id = ++runId;
        if (s.mainDone) {
          phase = 'extraDrawing';
          changed();
          void extraLoop(id);
        } else {
          phase = 'drawing';
          changed();
          void drawLoop(id);
        }
        return;
      }
      phase = 'idle';
      audio.greet(new Date(t).getHours());
      if (data.lastDailyBonus !== today) {
        data.lastDailyBonus = today;
        data.credits += DAILY_BONUS;
        bus.emit('dailyBonus', { amount: DAILY_BONUS });
      }
      audio.setMode('calm');
      persist(false);
      changed();
    },

    play() {
      if (phase !== 'idle') return;
      if (data.credits < totalBet() || data.credits < GIFT_THRESHOLD) {
        phase = 'gift';
        giftAmount = GIFT_AMOUNT;
        bus.emit('giftCredits', { amount: GIFT_AMOUNT });
        changed();
        return;
      }
      const bet = totalBet();
      data.credits -= bet;
      data.jackpot = nextJackpot(data.jackpot, bet);
      const { plan } = planRound({
        cards: data.cards,
        active: data.active,
        bet: data.bet,
        now: now(),
        director: data.director,
        rng: cryptoRng,
      });
      const s = new RoundSession(data.cards, data.active, data.bet, data.jackpot, plan);
      bus.emit('roundStart', { bet: data.bet, totalBet: bet });
      startSession(s);
    },

    accelerate() {
      if (phase !== 'drawing' || fast) return;
      fast = true;
      audio.setFast(true);
      wake?.();
      changed();
    },

    buyExtra() {
      extraResolver?.(true);
    },
    finishExtra() {
      extraResolver?.(false);
    },
    continueCelebration() {
      celebrationResolver?.();
    },

    takeGift() {
      if (phase !== 'gift') return;
      data.credits += giftAmount;
      data.stats.recargas++;
      giftAmount = 0;
      phase = 'idle';
      persist(false);
      saveNow(data);
      changed();
    },

    toggleCard(i) {
      if (phase !== 'idle') return;
      const next = data.active.slice();
      next[i] = !next[i];
      if (!next.some(Boolean)) return;
      data.active = next;
      persist(false);
      changed();
    },

    changeBet(dir) {
      if (phase !== 'idle') return;
      const i = BET_OPTIONS.indexOf(data.bet);
      const j = Math.max(0, Math.min(BET_OPTIONS.length - 1, i + dir));
      data.bet = BET_OPTIONS[j];
      persist(false);
      changed();
    },

    swapCards() {
      if (phase !== 'idle') return;
      data.cards = generateCards(cryptoRng);
      summary = null;
      drawn = [];
      current = null;
      persist(false);
      changed();
    },

    setAuto(on) {
      auto = on;
      changed();
      if (on && phase === 'idle') api.play();
    },

    updateSettings(p: Partial<Settings>) {
      data.settings = { ...data.settings, ...p };
      applyAudioSettings();
      persist(false);
      changed();
    },

    admin: {
      unlock(pin) {
        unlockedAdmin = pin === ADMIN_PIN;
        return unlockedAdmin;
      },
      snapshot() {
        if (!unlockedAdmin) return null;
        const st = data.stats;
        const days = Object.keys(st.rodadasPorDia);
        const avg = days.length ? st.rodadas / days.length : 0;
        return {
          credits: data.credits,
          jackpot: data.jackpot,
          historicoBingos: data.director.historicoBingos.map((t) => new Date(t).toLocaleDateString('pt-BR')),
          bingosPorMes: data.director.bingosPorMes,
          rodadas: st.rodadas,
          rodadasPorDia: Math.round(avg * 10) / 10,
          rtpComum: st.apostado ? Math.round((st.ganho / st.apostado) * 1000) / 1000 : 0,
          rtpTotal: st.apostadoTotal ? Math.round((st.ganhoTotal / st.apostadoTotal) * 1000) / 1000 : 0,
          recargas: st.recargas,
          porPadrao: st.porPadrao,
        };
      },
      exportJson() {
        return unlockedAdmin ? JSON.stringify({ ...data, round: null }) : '';
      },
      importJson(s) {
        if (!unlockedAdmin) return false;
        try {
          const d = migrate(JSON.parse(s), now());
          if (!d) return false;
          data = { ...d, round: null };
          saveNow(data);
          changed();
          return true;
        } catch {
          return false;
        }
      },
      resetJackpot() {
        if (!unlockedAdmin) return;
        data.jackpot = JACKPOT_BASE;
        persist(false);
        changed();
      },
      resetCredits() {
        if (!unlockedAdmin) return;
        data.credits = START_CREDITS;
        data.stats = emptyStats();
        persist(false);
        changed();
      },
    },
  };

  function emitSilent(step: Step): void {
    drawn.push(step.ball);
    current = step.ball;
  }

  applyAudioSettings();
  return api;
}
