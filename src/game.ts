import { bus } from './events';
import {
  ADMIN_PIN,
  BET_OPTIONS,
  COST_FACTOR,
  DEFAULT_TUNING,
  GIFT_THRESHOLD,
  JACKPOT_BASE,
  MAIL,
  SPEED_MS,
  START_CREDITS,
  TURBO_MS,
  effectivePin,
  setPatternSet,
  type PatternSetName,
} from './config';
import { generateCards } from './cards';
import { cryptoRng } from './rng';
import { RoundSession, type Step } from './round';
import { nextJackpot, prizeFor, prizeTable } from './payout';
import { levelOf } from './patterns';
import { planRound, afterRound, monthKey } from './director';
import { getDeviceInfo } from './perf';
import { load, migrate, save, saveNow, emptyStats, emptyMail, validTuning } from './storage';
import type { GameApi, GameView } from './gameApi';
import type { AdminStats, GamePhase, RoundSummary, RuntimeTuning, SaveData, Settings } from './types';
import { BALLS_EXTRA_MAX, BALLS_MAIN } from './types';
import { jackpotShare } from './config';

/** Interface mínima de áudio usada pelo jogo (implementada por src/audio). */
export interface AudioPort {
  unlock(): void | Promise<void>;
  greet(hour: number): void | Promise<void>;
  waitForSpeech(): Promise<void>;
  setFast(fast: boolean): void;
  setMode(mode: 'calm' | 'lively'): void;
  setVolumes(v: { music: number; voice: number; sfx: number; muted: boolean }): void;
  setBordoes?(on: boolean): void;
}

const LEVEL_CELEBRATE = levelOf('linhaDupla');
/** Chave antiga (v2.x) do conjunto de padrões; hoje vive em data.tuning. Só é lida para migrar. */
const LEGACY_PATTERN_SET_KEY = 'altina-da-sorte:patternSet';

function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * `?resetpin=1`: pede o PIN padrão (via `confirm`) e, se conferir, volta o PIN para o padrão.
 * Função pura: quem chama (main.ts) fornece `search` (location.search) e `confirm` (ex.: prompt).
 * Devolve true só se o PIN foi redefinido. Nunca registra o PIN em lugar nenhum.
 */
export function handleResetPinParam(
  api: Pick<GameApi, 'admin'>,
  search: string,
  confirm: () => string | null,
): boolean {
  if (!/(^|[?&])resetpin=1(&|$)/.test(search)) return false;
  const typed = confirm();
  if (typed === null || typed === undefined) return false;
  return api.admin.resetPin(String(typed));
}

export function createGame(audio: AudioPort, now: () => number = Date.now): GameApi {
  let data: SaveData = load(now());
  let phase: GamePhase = 'splash';
  let session: RoundSession | null = null;
  let drawn: number[] = [];
  let current: number | null = null;
  let summary: RoundSummary | null = null;
  let extraOffer: GameView['extraOffer'] = null;
  let auto = false;
  let fast = false; // Turbo ligado (ou rodada acelerada)
  let giftAmount = 0;
  let mailOpen = false;
  let roundStartedAt = 0;
  let runId = 0; // invalida laços antigos
  let wake: (() => void) | null = null;
  let unlockedAdmin = false;
  let extraResolver: ((buy: boolean) => void) | null = null;
  let celebrationResolver: (() => void) | null = null;

  try {
    // migra a chave separada antiga para data.tuning (uma vez) e a remove
    const ps = localStorage.getItem(LEGACY_PATTERN_SET_KEY);
    if (ps === 'classico' || ps === 'variado') {
      if (data.tuning.conjuntoPadroes === DEFAULT_TUNING.conjuntoPadroes) {
        data.tuning = { ...data.tuning, conjuntoPadroes: ps };
        saveNow(data);
      }
    }
    if (ps !== null) localStorage.removeItem(LEGACY_PATTERN_SET_KEY);
  } catch {
    /* ignora */
  }
  setPatternSet(data.tuning.conjuntoPadroes);

  const activeCount = () => data.active.filter(Boolean).length;
  const totalBet = () => data.bet * activeCount();
  const changed = () => bus.emit('stateChanged');
  const turbo = () => data.settings.turbo;
  const costFactor = () => COST_FACTOR[data.tuning.custoExtra];
  /** Troca de conjunto de padrões só vale fora de rodada (nunca muda o que está em jogo). */
  const applyPatternSet = () => {
    if (!session) setPatternSet(data.tuning.conjuntoPadroes);
  };

  function applyAudioSettings(): void {
    const s = data.settings;
    audio.setVolumes({ music: s.volMusic, voice: s.volVoice, sfx: s.volSfx, muted: s.muted });
    audio.setBordoes?.(s.bordoes);
  }

  function persist(round = true): void {
    if (round && session && (phase === 'drawing' || phase === 'extraOffer' || phase === 'extraDrawing')) {
      data.round = {
        bet: session.bet,
        jackpot: session.jackpot,
        plan: session.plan,
        mainIdx: session.mainIdx,
        extrasUsed: session.extrasUsed,
        extraSpent: session.extraSpent,
        cards: session.cards,
        active: session.active,
      };
    } else if (phase !== 'splash') {
      // Antes de ENTRAR a rodada salva ainda vai ser retomada: um ajuste nesse momento
      // (ex.: modo leve automático na abertura) não pode apagá-la (a aposta já foi debitada).
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

  function emitStep(step: Step, silent = false): void {
    drawn.push(step.ball);
    current = step.ball;
    if (silent) return;
    bus.emit('ballDrawn', {
      ball: step.ball,
      index: step.index,
      total: step.extra ? BALLS_EXTRA_MAX : BALLS_MAIN,
      extra: step.extra,
      fast,
    });
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
    fast = turbo();
    audio.setFast(fast);
    while (!s.mainDone && id === runId) {
      if (fast) {
        // Turbo: todas as bolas restantes saem de uma vez e as cartelas já aparecem preenchidas.
        drawAllAtOnce();
        persist();
        await sleep(TURBO_MS);
        break;
      }
      const step = s.nextMain()!;
      emitStep(step);
      persist();
      await audio.waitForSpeech();
      if (id !== runId) return;
      await sleep(fast ? 0 : SPEED_MS[data.settings.speed]);
    }
    if (id !== runId) return;
    await extraLoop(id);
  }

  /** Turbo: sorteia o resto das 30 bolas num único passo (um tique, um redesenho, prêmios anunciados juntos). */
  function drawAllAtOnce(): void {
    const s = session!;
    const steps: Step[] = [];
    while (!s.mainDone) steps.push(s.nextMain()!);
    if (!steps.length) return;
    for (const st of steps) {
      drawn.push(st.ball);
      current = st.ball;
    }
    const last = steps[steps.length - 1];
    bus.emit('ballDrawn', { ball: last.ball, index: last.index, total: BALLS_MAIN, extra: false, fast: true });
    for (const st of steps) {
      for (const w of st.won) {
        bus.emit('patternWon', { cardIndex: w.cardIndex, pattern: w.pattern, prize: prizeFor(w.pattern, s.bet), ball: st.ball });
      }
      if (st.bingo) {
        bus.emit('bingo', { cardIndex: st.bingo.cardIndex, viaExtra: false });
        if (s.jackpotAmount > 0) bus.emit('jackpot', { amount: s.jackpotAmount });
      }
    }
    changed();
  }

  async function extraLoop(id: number): Promise<void> {
    const s = session!;
    for (;;) {
      if (id !== runId) return;
      const offer = s.offer();
      if (!offer) break;
      // Na oferta de extra a voz volta ao normal (mesmo com Turbo); o Turbo continua ligado.
      audio.setFast(false);
      auto = false; // jogo automático para em qualquer oferta
      phase = 'extraOffer';
      // `gain` mostrado na tela = prêmio total do padrão que sai se a bola vier
      const improves = offer.improves.map((i) => ({ ...i, gain: prizeFor(i.pattern, s.bet) }));
      extraOffer = { cost: offer.cost, free: offer.free, remaining: offer.remaining, improves };
      bus.emit('extraOffer', extraOffer);
      if (offer.free) bus.emit('freeExtra');
      persist();
      changed();
      const buy = await new Promise<boolean>((res) => (extraResolver = res));
      extraResolver = null;
      if (id !== runId) return;
      extraOffer = null;
      if (!buy) break;
      if (data.credits < offer.cost) {
        data.credits += data.tuning.presente; // créditos infinitos
        data.stats.recargas++;
        bus.emit('giftCredits', { amount: data.tuning.presente });
      }
      data.credits -= offer.cost;
      phase = 'extraDrawing';
      const r = s.buyExtra();
      if (!r) break;
      bus.emit('extraBought', { cost: r.cost, number: r.step.ball });
      emitStep(r.step);
      persist();
      await audio.waitForSpeech();
      await sleep(600);
    }
    await settle(id);
  }

  async function settle(id: number): Promise<void> {
    const s = session!;
    phase = 'settling';
    changed();
    const sum = s.finish();
    summary = sum;
    data.credits += sum.prize;
    if (sum.jackpot > 0) data.jackpot = JACKPOT_BASE;
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
    data.turboRounds++;
    // grava já (rodada encerrada + prêmio creditado): recarregar agora não pode pagar duas vezes
    data.round = null;
    saveNow(data);
    trackPlayTime();
    const hadBingo = sum.results.some((r) => r.pattern === 'bingo');
    data.director = afterRound(data.director, now(), hadBingo);
    bus.emit('roundEnd', { summary: sum, won: sum.prize > 0 });
    session = null;
    audio.setFast(false);
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
    applyPatternSet();
    maybeBonusMail();
    persist(false);
    saveNow(data);
    changed();
    maybeAuto(big);
  }

  function maybeAuto(wasBig: boolean): void {
    if (!auto || wasBig || data.mail.pending) {
      // celebração grande desliga o automático; com correio pendente ele espera o PEGAR (claimMail retoma)
      if (wasBig && auto) {
        auto = false;
        changed();
      }
      return;
    }
    setTimeout(() => {
      if (auto && phase === 'idle') api.play();
    }, 900);
  }

  // ---------- correio da sorte ----------
  function rollMailDay(): void {
    const today = dayKey(now());
    if (data.mail.day !== today) data.mail = { ...emptyMail(), day: today, pending: data.mail.pending };
  }

  function trackPlayTime(): void {
    rollMailDay();
    if (roundStartedAt) data.mail.playMs += Math.max(0, now() - roundStartedAt);
    roundStartedAt = 0;
  }

  function maybeBonusMail(): void {
    rollMailDay();
    // tablet ficou aberto e virou o dia: o correio diário chega sem precisar reabrir o jogo
    const today = dayKey(now());
    if (data.lastDailyBonus !== today && !data.mail.pending) {
      data.mail.pending = { kind: 'daily', amount: data.tuning.correioDiario };
      bus.emit('mailbox', { kind: 'daily', amount: data.tuning.correioDiario, state: 'arrived' });
      return;
    }
    const m = data.mail;
    if (m.pending || m.bonusToday >= MAIL.bonusMaxPerDay) return;
    if (m.playMs < (m.bonusToday + 1) * MAIL.minPlayMsBeforeBonus) return;
    if (cryptoRng() > 0.25) return;
    const steps = (MAIL.bonusMax - MAIL.bonusMin) / 10;
    const amount = MAIL.bonusMin + 10 * Math.floor(cryptoRng() * (steps + 1));
    m.bonusToday++;
    m.pending = { kind: 'bonus', amount };
    bus.emit('mailbox', { kind: 'bonus', amount, state: 'arrived' });
  }

  function startSession(s: RoundSession): void {
    session = s;
    drawn = [];
    current = null;
    summary = null;
    extraOffer = null;
    fast = turbo();
    audio.setFast(fast);
    const id = ++runId;
    phase = 'drawing';
    changed();
    void drawLoop(id);
  }

  const api: GameApi = {
    getView(): GameView {
      const mp = data.mail.pending;
      return {
        phase,
        credits: data.credits,
        bet: data.bet,
        totalBet: totalBet(),
        jackpot: Math.floor(data.jackpot),
        cards: data.cards,
        active: data.active,
        drawn,
        current,
        mainCount: Math.min(BALLS_MAIN, session ? session.mainIdx : drawn.length),
        extraOffer,
        extraTotal: BALLS_EXTRA_MAX,
        extrasDrawn: session ? session.extrasUsed : 0,
        turbo: turbo(),
        cardCount: activeCount(),
        prizeTable: prizeTable(data.bet),
        jackpotShare: jackpotShare(data.bet),
        mail: mp && phase === 'idle' ? { kind: mp.kind, amount: mp.amount, open: mailOpen } : null,
        summary,
        auto,
        settings: data.settings,
        giftAmount,
      };
    },

    enter() {
      if (phase !== 'splash') return;
      void audio.unlock();
      applyAudioSettings();
      const t = now();
      const today = dayKey(t);
      void audio.greet(new Date(t).getHours());
      if (data.round) {
        // retoma a rodada exatamente de onde parou
        const s = RoundSession.fromSaved(data.round, costFactor());
        drawn = [...s.drawn];
        current = drawn[drawn.length - 1] ?? null;
        session = s;
        roundStartedAt = t;
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
      rollMailDay();
      if (data.lastDailyBonus !== today && !data.mail.pending) {
        data.mail.pending = { kind: 'daily', amount: data.tuning.correioDiario };
        bus.emit('mailbox', { kind: 'daily', amount: data.tuning.correioDiario, state: 'arrived' });
      }
      audio.setMode('calm');
      persist(false);
      changed();
    },

    play() {
      if (phase !== 'idle') return;
      mailOpen = false;
      if (data.credits < totalBet() || data.credits < GIFT_THRESHOLD) {
        phase = 'gift';
        giftAmount = data.tuning.presente;
        bus.emit('giftCredits', { amount: giftAmount });
        changed();
        return;
      }
      setPatternSet(data.tuning.conjuntoPadroes); // ajustes novos valem a partir desta rodada
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
        tuning: data.tuning,
      });
      const s = new RoundSession(data.cards, data.active, data.bet, Math.floor(data.jackpot), plan, 0, costFactor());
      roundStartedAt = now();
      bus.emit('roundStart', { bet: data.bet, totalBet: bet });
      startSession(s);
    },

    setTurbo(on) {
      data.settings = { ...data.settings, turbo: on };
      bus.emit('turboChanged', { on });
      if (phase === 'drawing') {
        fast = on;
        audio.setFast(on);
        if (on) wake?.();
      }
      persist(phase !== 'idle');
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
      auto = false;
      phase = 'idle';
      persist(false);
      saveNow(data);
      changed();
    },

    openMail() {
      const mp = data.mail.pending;
      if (phase !== 'idle' || !mp) return;
      mailOpen = true;
      bus.emit('mailbox', { kind: mp.kind, amount: mp.amount, state: 'opened' });
      changed();
    },

    claimMail() {
      const mp = data.mail.pending;
      if (!mp || !mailOpen) return;
      data.credits += mp.amount;
      if (mp.kind === 'daily') data.lastDailyBonus = dayKey(now());
      data.mail.pending = null;
      mailOpen = false;
      bus.emit('mailbox', { kind: mp.kind, amount: mp.amount, state: 'claimed' });
      persist(false);
      saveNow(data);
      changed();
      maybeAuto(false); // automático ligado volta a jogar depois de pegar o correio
    },

    changeBet(dir) {
      if (phase !== 'idle') return;
      const i = BET_OPTIONS.indexOf(data.bet);
      const j = Math.max(0, Math.min(BET_OPTIONS.length - 1, i + dir));
      data.bet = BET_OPTIONS[j];
      persist(false);
      changed();
    },

    changeCards(dir) {
      if (phase !== 'idle') return;
      const n = Math.max(1, Math.min(4, activeCount() + dir));
      data.active = [0, 1, 2, 3].map((i) => i < n);
      persist(false);
      changed();
    },

    shuffleCards() {
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
      if (on && phase === 'idle' && !data.mail.pending) api.play();
    },

    updateSettings(p: Partial<Settings>) {
      // O modo leve automático (lightManual:false explícito) nunca sobrescreve a escolha manual.
      if (p.light !== undefined && p.lightManual === undefined) p = { ...p, lightManual: true };
      if (p.lightManual === false && data.settings.lightManual) {
        const { light: _l, lightManual: _m, ...rest } = p;
        p = rest;
      }
      data.settings = { ...data.settings, ...p };
      applyAudioSettings();
      if (p.turbo !== undefined) api.setTurbo(p.turbo);
      persist(false);
      changed();
    },

    admin: {
      unlock(pin) {
        unlockedAdmin = typeof pin === 'string' && pin === effectivePin(data.adminPin);
        return unlockedAdmin;
      },
      lock() {
        unlockedAdmin = false;
      },
      stats(): AdminStats | null {
        if (!unlockedAdmin) return null;
        const st = data.stats;
        const dir = data.director;
        const days = Object.keys(st.rodadasPorDia);
        const avg = days.length ? st.rodadas / days.length : 0;
        const t = now();
        return {
          creditos: data.credits,
          acumulado: Math.floor(data.jackpot),
          bingosNoMes: dir.bingosPorMes[monthKey(t)] ?? 0,
          ultimosBingos: dir.historicoBingos
            .slice(-8)
            .reverse()
            .map((ms) => new Date(ms).toLocaleDateString('pt-BR')),
          diasDesdeUltimoBingo: dir.ultimoBingoEm === null ? null : Math.max(0, Math.floor((t - dir.ultimoBingoEm) / 86400000)),
          rodadas: st.rodadas,
          rodadasPorDia: Math.round(avg * 10) / 10,
          premiosPorTipo: { ...st.porPadrao },
          rtpComum: st.apostado ? Math.round((st.ganho / st.apostado) * 1000) / 1000 : 0,
          rtpTotal: st.apostadoTotal ? Math.round((st.ganhoTotal / st.apostadoTotal) * 1000) / 1000 : 0,
          recargas: st.recargas,
          tuning: { ...data.tuning },
        };
      },
      device() {
        return unlockedAdmin ? getDeviceInfo() : null;
      },
      getTuning(): RuntimeTuning {
        return { ...(unlockedAdmin ? data.tuning : DEFAULT_TUNING) };
      },
      setTuning(p) {
        if (!unlockedAdmin || !p || typeof p !== 'object') return;
        // só valores válidos entram: cada campo é validado contra o seu enum (inválido = ignorado)
        const checked = validTuning({ ...data.tuning, ...p }) as unknown as Record<string, unknown>;
        const next = { ...data.tuning } as unknown as Record<string, unknown>;
        const src = p as Record<string, unknown>;
        for (const k of Object.keys(src)) {
          if (k in next && checked[k] === src[k]) next[k] = src[k];
        }
        data.tuning = next as unknown as RuntimeTuning;
        // a rodada em curso mantém plano, padrões e custo; o resto vale a partir da próxima
        applyPatternSet();
        saveNow(data);
        changed();
      },
      resetTuning() {
        if (!unlockedAdmin) return;
        data.tuning = { ...DEFAULT_TUNING };
        applyPatternSet();
        saveNow(data);
        changed();
      },
      changePin(oldPin, newPin) {
        if (!unlockedAdmin) return false;
        if (typeof oldPin !== 'string' || oldPin !== effectivePin(data.adminPin)) return false;
        if (typeof newPin !== 'string' || !/^\d{4}$/.test(newPin)) return false;
        data.adminPin = newPin;
        saveNow(data);
        return true;
      },
      resetPin(defaultPin) {
        // autentica pelo PIN padrão do código (não exige unlock; usado por ?resetpin=1)
        if (typeof defaultPin !== 'string' || defaultPin !== ADMIN_PIN) return false;
        data.adminPin = null;
        saveNow(data);
        return true;
      },
      exportJson() {
        return unlockedAdmin ? JSON.stringify({ ...data, round: null }) : '';
      },
      importJson(s) {
        if (!unlockedAdmin || session) return false;
        try {
          const d = migrate(JSON.parse(s), now());
          if (!d) return false;
          data = { ...d, round: null };
          setPatternSet(data.tuning.conjuntoPadroes);
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
      setPatternSet(name: PatternSetName) {
        if (!unlockedAdmin || (name !== 'classico' && name !== 'variado')) return;
        api.admin.setTuning({ conjuntoPadroes: name });
      },
    },
  };

  applyAudioSettings();
  return api;
}
