// Fachada de áudio do jogo: assina o barramento de eventos e dispara voz, efeitos e música.
// UI e regras só conhecem esta API.
import type { Bus } from '../events';
import { PATTERN_ORDER } from '../types';
import type { PatternId } from '../types';
import { AudioEngine } from './engine';
import type { Volumes } from './engine';
import { Music } from './music';
import type { MusicMode } from './music';
import { Narrator, createSynthSpeaker } from './narrator';
import { GROUPS, numberId, periodOf, pickVariant, preloadOrder, prizeIds } from './script';
import { Sfx } from './sfx';

export type { Volumes } from './engine';
export type { MusicMode } from './music';

export interface AudioApi {
  /** Chamar no primeiro toque (botão ENTRAR). Libera o áudio, inicia o carregamento e a trilha calma. */
  unlock(): Promise<void>;
  /** Saudação por horário (0–23). Resolve quando a fala termina. */
  greet(hour: number): Promise<void>;
  /** Resolve quando a narração em curso (e a fila) termina. O jogo espera isto antes da próxima bola. */
  waitForSpeech(): Promise<void>;
  setVolumes(v: Partial<Volumes>): void;
  getVolumes(): Volumes;
  /** Rodada acelerada: narra só os prêmios. */
  setFast(fast: boolean): void;
  setMode(mode: MusicMode): void;
  /** Legenda da fala atual ('' quando termina). Retorna função para cancelar a assinatura. */
  onCaption(cb: (text: string) => void): () => void;
  /** Efeitos avulsos para a UI (ex.: sfx.mark() ao tocar numa pedra, sfx.coins() na contagem). */
  readonly sfx: Sfx;
  dispose(): void;
}

export interface CreateAudioOptions {
  engine?: AudioEngine;
}

const SMALL: PatternId[] = ['linha', 'cantos'];
const rank = (p: PatternId): number => PATTERN_ORDER.indexOf(p);

export function createAudio(bus: Bus, opts: CreateAudioOptions = {}): AudioApi {
  const engine = opts.engine ?? new AudioEngine();
  const sfx = new Sfx(engine);
  const music = new Music(engine);
  const captionCbs = new Set<(t: string) => void>();
  const last: Record<string, string> = {};
  let fast = false;
  let mode: MusicMode = 'calm';
  let disposed = false;
  let offVis: (() => void) | null = null;

  const narrator = new Narrator({
    clips: engine,
    synth: createSynthSpeaker(),
    getVolume: () => engine.getVolumes().voice,
    isMuted: () => {
      const v = engine.getVolumes();
      return v.muted || v.voice <= 0.01;
    },
    onCaption: (t) => captionCbs.forEach((cb) => cb(t)),
    onActive: (on) => engine.setSpeaking(on),
  });

  /** Sorteia uma variação do grupo evitando repetir a última. */
  const pick = (key: string, ids: readonly string[]): string => {
    const id = pickVariant(ids, last[key]);
    last[key] = id;
    return id;
  };

  const musicAudible = () => {
    const v = engine.getVolumes();
    return !v.muted && v.music > 0.02;
  };

  const celebrate = (kind: 'win' | 'bingo') => {
    if (musicAudible() && music.stinger(kind)) return;
    if (kind === 'bingo') sfx.bingoFanfare();
    else sfx.bigWin();
  };

  // várias cartelas premiadas na mesma bola → fala só o maior padrão
  let pendingWin: PatternId | null = null;
  let flushQueued = false;
  const flushWin = () => {
    flushQueued = false;
    const p = pendingWin;
    pendingWin = null;
    if (!p) return;
    const preempt = narrator.currentCategory !== 'number'; // não corta o número que acabou de sair
    void narrator.say(pick(`prize_${p}`, prizeIds(p)), { preempt, dropIfBusy: false });
    if (p === 'bingo') return; // som do bingo vem do evento `bingo`
    if (SMALL.includes(p)) sfx.smallWin();
    else celebrate('win');
  };

  const offs = [
    bus.on('roundStart', () => {
      music.setMode('lively');
      mode = 'lively';
      void narrator.say(pick('start', GROUPS.start));
    }),
    bus.on('ballDrawn', (e) => {
      if (e.fast || fast) return; // acelerado: só prêmios
      sfx.ballDraw();
      void narrator.say(numberId(e.ball));
    }),
    bus.on('almost', (e) => {
      sfx.almost();
      void narrator.say(pick(e.forBingo ? 'almostB' : 'almost', e.forBingo ? GROUPS.almostBingo : GROUPS.almost), {
        preempt: false,
        expireMs: 2500,
      });
    }),
    bus.on('patternWon', (e) => {
      if (!pendingWin || rank(e.pattern) > rank(pendingWin)) pendingWin = e.pattern;
      if (!flushQueued) {
        flushQueued = true;
        queueMicrotask(flushWin);
      }
    }),
    bus.on('extraOffer', () => {
      void narrator.say(GROUPS.extraOffer[0], { preempt: false, dropIfBusy: false });
    }),
    bus.on('extraBought', () => {
      sfx.coins(3);
      void narrator.say(GROUPS.extraBought[0], { preempt: false, dropIfBusy: false });
    }),
    bus.on('roundEnd', (e) => {
      music.setMode('calm');
      mode = 'calm';
      if (e.won) {
        sfx.coins(Math.min(14, 4 + Math.round(Math.log2(e.summary.prize + 1))));
      } else {
        void narrator.say(pick('noprize', GROUPS.noprize), { preempt: false, dropIfBusy: false });
      }
    }),
    bus.on('bingo', () => celebrate('bingo')),
    bus.on('jackpot', () => {
      void narrator.say(pick('jackpot', GROUPS.jackpot), { preempt: false, dropIfBusy: false });
      sfx.coins(16);
    }),
    bus.on('giftCredits', () => {
      sfx.smallWin();
      sfx.coins(10);
      void narrator.say(pick('gift', GROUPS.gift), { preempt: false, dropIfBusy: false });
    }),
    bus.on('dailyBonus', () => {
      sfx.coins(8);
      void narrator.say(`gift_daily_${periodOf(new Date().getHours())}`, { preempt: false, dropIfBusy: false });
    }),
  ];

  const syncMusicPlayback = () => {
    const v = engine.getVolumes();
    if (v.muted || v.music <= 0.01) music.pause();
    else music.resume();
  };

  return {
    sfx,
    async unlock() {
      if (disposed) return;
      await engine.unlock();
      if (!engine.ctx) return;
      engine.preload(preloadOrder());
      engine.warm(['greet_morning', 'greet_afternoon', 'greet_night', 'start_1', 'start_2', 'start_3']);
      if (!music.isRunning) {
        music.start(mode);
        offVis = engine.onVisibility((hidden) => {
          if (!hidden) syncMusicPlayback(); // não "des-muta" a trilha ao voltar do segundo plano
        });
      }
      syncMusicPlayback();
    },
    greet(hour) {
      return narrator.say(`greet_${periodOf(hour)}`, { dropIfBusy: false, preempt: false });
    },
    waitForSpeech() {
      if (pendingWin) flushWin();
      return narrator.idle();
    },
    setVolumes(v) {
      engine.setVolumes(v);
      syncMusicPlayback();
    },
    getVolumes: () => engine.getVolumes(),
    setFast(f) {
      fast = f;
      narrator.setFast(f);
    },
    setMode(m) {
      mode = m;
      music.setMode(m);
    },
    onCaption(cb) {
      captionCbs.add(cb);
      return () => captionCbs.delete(cb);
    },
    dispose() {
      disposed = true;
      offVis?.();
      offs.forEach((o) => o());
      narrator.dispose();
      music.dispose();
      sfx.dispose();
      engine.dispose();
      captionCbs.clear();
    },
  };
}
