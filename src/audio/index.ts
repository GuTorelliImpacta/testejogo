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
import { GROUPS, numberId, periodOf, pickNumberLine, pickVariant, preloadOrder, prizeIds } from './script';
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
  /** Bordões tradicionais de bingo em ~1 de cada 8 bolas que tenham um (padrão: ligado). */
  setBordoes(on: boolean): void;
  setMode(mode: MusicMode): void;
  /**
   * Modo econômico: música pré-renderizada em 24 kHz (menos memória/CPU) e cache de voz menor.
   * A integração chama conforme settings.light / modo econômico automático. Pode ser chamado a qualquer hora.
   */
  setEconomy(on: boolean): void;
  /** Dica: próximos números prováveis (ex.: os que o sorteio vai usar); decodifica só alguns, em tempo ocioso. */
  hintNext(balls: readonly number[]): void;
  /** Legenda da fala atual ('' quando termina). Retorna função para cancelar a assinatura. */
  onCaption(cb: (text: string) => void): () => void;
  /** Efeitos avulsos para a UI (ex.: sfx.mark() ao tocar numa pedra, sfx.coins() na contagem). */
  readonly sfx: Sfx;
  dispose(): void;
}

export interface CreateAudioOptions {
  engine?: AudioEngine;
  /** Aleatoriedade (testes/prévia); padrão Math.random. */
  rnd?: () => number;
  /** Música injetada (testes/prévia). */
  music?: Music;
}

const SMALL: PatternId[] = ['linha', 'cantos'];
const rank = (p: PatternId): number => PATTERN_ORDER.indexOf(p);

export function createAudio(bus: Bus, opts: CreateAudioOptions = {}): AudioApi {
  const engine = opts.engine ?? new AudioEngine();
  const sfx = new Sfx(engine);
  const music = opts.music ?? new Music(engine);
  const captionCbs = new Set<(t: string) => void>();
  const last: Record<string, string> = {};
  const rnd = opts.rnd ?? Math.random;
  let fast = false;
  let lastBallFast = false;
  let bordoes = true;
  let lastFreeAt = -1e9;
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

  /** Fala 'Bola extra grátis!' + plim, uma vez só mesmo que freeExtra e extraOffer.free cheguem juntos. */
  const announceFreeExtra = () => {
    const now = Date.now();
    if (now - lastFreeAt < 1500) return;
    lastFreeAt = now;
    sfx.plim();
    void narrator.say(GROUPS.extraFree[0], { preempt: false, dropIfBusy: false });
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
    if (p === 'linha') sfx.jingleLinha();
    else if (p === 'linhaDupla') sfx.jingleLinhaDupla();
    else if (SMALL.includes(p)) sfx.smallWin();
    else celebrate('win');
  };

  // qualquer evento do jogo acorda o áudio (se estava suspenso por ociosidade)
  engine.musicActive = () => music.isPlaying && musicAudible();
  const on = ((ev: any, fn: any) =>
    bus.on(ev, (e: any) => {
      engine.wake();
      fn(e);
    })) as Bus['on'];
  /** Falas de prêmio/oferta: decodificadas com antecedência e fixadas no cache. */
  const warmPrizes = () => {
    const ids = [...PATTERN_ORDER.flatMap((p) => prizeIds(p).slice(0, 2)), ...GROUPS.extraOffer, ...GROUPS.extraFree, ...GROUPS.extraLinhaDupla];
    engine.warm(ids, { pin: true });
  };

  const offs = [
    on('roundStart', () => {
      warmPrizes();
      music.setMode('lively');
      mode = 'lively';
      void narrator.say(pick('start', GROUPS.start));
    }),
    on('ballDrawn', (e) => {
      lastBallFast = e.fast;
      if (e.fast || fast) {
        sfx.tick(); // acelerado/Turbo: só um tique, voz só nos prêmios
        return;
      }
      sfx.ballDraw();
      // não corta a fala de início ("Valendo!")
      void narrator.say(pickNumberLine(e.ball, bordoes, rnd), { preempt: narrator.currentCategory !== 'start' });
    }),
    on('almost', (e) => {
      // se a fala é calada (Turbo/acelerado), o efeito dela também
      const silent = fast || lastBallFast;
      if (!silent) sfx.almost();
      void narrator.say(pick(e.forBingo ? 'almostB' : 'almost', e.forBingo ? GROUPS.almostBingo : GROUPS.almost), {
        preempt: false,
        expireMs: 2500,
      });
    }),
    on('patternWon', (e) => {
      if (!pendingWin || rank(e.pattern) > rank(pendingWin)) pendingWin = e.pattern;
      if (!flushQueued) {
        flushQueued = true;
        queueMicrotask(flushWin);
      }
    }),
    on('extraOffer', (e) => {
      if (e.free) {
        announceFreeExtra();
        return;
      }
      const dupla = e.improves.some((i) => i.pattern === 'linhaDupla');
      const id = dupla ? GROUPS.extraLinhaDupla[0] : GROUPS.extraOffer[0];
      void narrator.say(id, { preempt: false, dropIfBusy: false });
    }),
    on('freeExtra', announceFreeExtra),
    on('mailbox', (e) => {
      if (e.state !== 'arrived') return; // aberta/pega: a UI já tem sons próprios (moedas no presente)
      sfx.plim();
      void narrator.say(GROUPS.mail[0], { preempt: false, dropIfBusy: false });
    }),
    on('turboChanged', (e) => {
      fast = e.on;
      narrator.setFast(e.on);
      if (e.on) void narrator.say(GROUPS.turbo[0], { preempt: false, dropIfBusy: false });
    }),
    on('extraBought', () => {
      sfx.coins(3);
      void narrator.say(GROUPS.extraBought[0], { preempt: false, dropIfBusy: false });
    }),
    on('roundEnd', (e) => {
      music.setMode('calm');
      mode = 'calm';
      if (e.won) {
        sfx.coins(Math.min(14, 4 + Math.round(Math.log2(e.summary.prize + 1))));
      } else {
        void narrator.say(pick('noprize', GROUPS.noprize), { preempt: false, dropIfBusy: false });
      }
    }),
    on('bingo', () => celebrate('bingo')),
    on('jackpot', () => {
      void narrator.say(pick('jackpot', GROUPS.jackpot), { preempt: false, dropIfBusy: false });
      sfx.jingleJackpot();
      sfx.coins(16);
    }),
    on('giftCredits', () => {
      sfx.smallWin();
      sfx.coins(10);
      void narrator.say(pick('gift', GROUPS.gift), { preempt: false, dropIfBusy: false });
    }),
    on('dailyBonus', () => {
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
    async greet(hour) {
      // espera o clipe carregar (até 1,5 s) para a saudação sair na voz gravada, não na do tablet
      const id = `greet_${periodOf(hour)}`;
      const t0 = Date.now();
      while (engine.has(id) && !engine.isLoaded(id) && Date.now() - t0 < 1500) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return narrator.say(id, { dropIfBusy: false, preempt: false });
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
    setBordoes(on) {
      bordoes = on;
    },
    setMode(m) {
      mode = m;
      engine.wake();
      music.setMode(m);
    },
    setEconomy(on) {
      music.setEconomy(on);
      engine.setEconomy(on);
    },
    hintNext(balls) {
      engine.warm(balls.slice(0, 6).map(numberId));
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
