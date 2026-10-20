// Motor de áudio: um único AudioContext, grafo master → [music, voice, sfx],
// volumes independentes, ducking, carregador de clipes em segundo plano.
//
// Memória (v3): os clipes baixados ficam COMPRIMIDOS (`raw`, ~7 KB cada); só são decodificados sob demanda
// (`play`) ou por `warm()` (poucos ids). Os decodificados formam um LRU limitado por quantidade E por bytes
// (o que estourar primeiro): 48 clipes / 24 MB no normal, 32 clipes / 12 MB no modo econômico. Ids "fixados"
// (falas de prêmio/oferta) só saem se não houver mais nada a liberar. `preload()` nunca decodifica.
// Ocioso: sem fala/efeito/música tocando por IDLE_SUSPEND_MS o AudioContext é suspenso (`ctx.suspend()`) e
// volta em `wake()` (unlock, play, qualquer efeito ou evento do jogo).
import { decodeCompat, getContextCtor } from './compat';

export interface Volumes {
  music: number; // 0..1
  voice: number;
  sfx: number;
  muted: boolean;
}

export const DEFAULT_VOLUMES: Volumes = { music: 0.4, voice: 1, sfx: 0.7, muted: false };

/** Fala em andamento. `done` sempre resolve (fim natural ou stop()). */
export interface SpeechHandle {
  done: Promise<void>;
  stop(): void;
}

/** O que o narrador precisa de um motor de clipes. */
export interface ClipPlayer {
  /** true se o clipe existe e pode tocar agora. */
  has(id: string): boolean;
  /** Toca o clipe; null se indisponível. */
  play(id: string): SpeechHandle | null;
}

export interface EngineOptions {
  /** Prefixo dos arquivos (padrão '/audio'). */
  baseUrl?: string;
  fetchFn?: typeof fetch;
  createContext?: () => AudioContext;
  /** Tempo ocioso até suspender o contexto (padrão IDLE_SUSPEND_MS). */
  idleMs?: number;
}

const DUCK_LEVEL = 0.3;
const DUCK_DOWN_S = 0.18;
const DUCK_UP_S = 0.25;
const DUCK_RELEASE_DELAY_MS = 220;
/** Limites do cache de clipes decodificados (o menor que não causa 'stutter': ~48 números+prêmios recentes). */
export const DECODED_LIMITS = {
  normal: { clips: 48, bytes: 24 * 1024 * 1024 },
  economy: { clips: 32, bytes: 12 * 1024 * 1024 },
} as const;
/** Sem atividade por este tempo (e sem música audível tocando) → AudioContext suspenso. */
export const IDLE_SUSPEND_MS = 90_000;
const FETCH_CONCURRENCY = 3;
/** M12: folga sobre a duração do clipe, e limite para a decodificação. */
const CLIP_SLACK_MS = 1500;
const DECODE_TIMEOUT_MS = 4000;

/** Curva de percepção: 0.4 → ~0.25, 0.7 → ~0.59, 1 → 1. */
export const volCurve = (v: number): number => Math.pow(Math.min(1, Math.max(0, v)), 1.5);

export class AudioEngine implements ClipPlayer {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  voiceBus!: GainNode;
  sfxBus!: GainNode;
  private duck!: GainNode;

  private vols: Volumes = { ...DEFAULT_VOLUMES };
  private base: string;
  private fetchFn: typeof fetch | null;

  private raw = new Map<string, ArrayBuffer>();
  private missing = new Set<string>();
  private decoded = new Map<string, AudioBuffer>(); // ordem = LRU
  private decodedBytes = 0;
  private pinned = new Set<string>();
  private limits: { clips: number; bytes: number } = DECODED_LIMITS.normal;
  private decoding = new Map<string, Promise<AudioBuffer | null>>();
  private queue: string[] = [];
  private queued = new Set<string>();
  private inflight = 0;
  private manifests: { gen: Map<string, string[]> | null; custom: Map<string, string[]> | null } | null = null;
  private manifestP: Promise<void> | null = null;
  private exts: string[] = ['webm', 'mp3'];
  private releaseT: ReturnType<typeof setTimeout> | undefined;
  private visHandler: (() => void) | null = null;
  private visListeners = new Set<(hidden: boolean) => void>();
  private disposed = false;
  private silentDone = false;
  private speaking = false;
  private lastActive = Date.now();
  private idleT: ReturnType<typeof setTimeout> | undefined;
  private _idleSuspended = false;
  /** O jogo informa se há música audível tocando (nesse caso nunca suspende por ociosidade). */
  musicActive: () => boolean = () => false;

  constructor(private opts: EngineOptions = {}) {
    this.base = (opts.baseUrl ?? '/audio').replace(/\/$/, '');
    this.fetchFn = opts.fetchFn ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  get unlocked(): boolean {
    return !!this.ctx && (this.ctx.state === 'running' || this._idleSuspended);
  }
  /** true enquanto o contexto está suspenso por ociosidade (volta sozinho em wake()). */
  get idleSuspended(): boolean {
    return this._idleSuspended;
  }

  /** Modo econômico: cache de clipes decodificados menor. */
  setEconomy(on: boolean): void {
    this.limits = on ? DECODED_LIMITS.economy : DECODED_LIMITS.normal;
    this.evict();
  }

  /** Atividade (fala, efeito, evento do jogo, toque): adia a suspensão e retoma o contexto se preciso. */
  wake(): void {
    if (this.disposed) return;
    this.lastActive = Date.now();
    if (this._idleSuspended && this.ctx) {
      this._idleSuspended = false;
      void this.ctx.resume().catch(() => {});
    }
    this.armIdle(this.opts.idleMs ?? IDLE_SUSPEND_MS);
  }

  private armIdle(ms: number): void {
    if (this.idleT !== undefined || this.disposed || !this.ctx) return;
    this.idleT = setTimeout(() => {
      this.idleT = undefined;
      this.checkIdle();
    }, ms);
  }

  private checkIdle(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    const limit = this.opts.idleMs ?? IDLE_SUSPEND_MS;
    const left = limit - (Date.now() - this.lastActive);
    if (left > 0) return this.armIdle(left);
    if (ctx.state === 'running' && !this._idleSuspended && !this.speaking && !this.musicActive()) {
      this._idleSuspended = true; // antes do suspend: o handler de onstatechange não pode retomar
      void ctx.suspend().catch(() => {});
      return;
    }
    this.armIdle(limit); // música/fala em curso: confere de novo depois
  }

  /** Chamar no primeiro toque. Cria o contexto de forma síncrona (exigência dos navegadores). */
  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx && !this.build()) return;
    const ctx = this.ctx!;
    this._idleSuspended = false;
    this.wake();
    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch {
      /* ignora */
    }
    if (!this.silentDone) {
      this.silentDone = true;
      try {
        // buffer mudo: destrava iOS antigos
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start();
      } catch {
        /* ignora */
      }
    }
  }

  private build(): boolean {
    try {
      const Ctor: typeof AudioContext | undefined = getContextCtor();
      const ctx = this.opts.createContext ? this.opts.createContext() : Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
      if (!ctx) return false;
      this.ctx = ctx;
    } catch {
      return false;
    }
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.duck = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.duck);
    this.duck.connect(this.master);
    this.voiceBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.applyVolumes(true);

    // M12: se o sistema suspender o contexto (ligação, outro app) com a aba visível, tenta retomar
    try {
      ctx.onstatechange = () => {
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        if (!this.disposed && this.ctx === ctx && ctx.state === 'suspended' && !hidden && !this._idleSuspended) {
          void ctx.resume().catch(() => {});
        }
      };
    } catch {
      /* ignora */
    }

    this.exts = canPlayWebmOpus() ? ['webm', 'mp3'] : ['mp3'];
    if (typeof document !== 'undefined') {
      this.visHandler = () => {
        const hidden = document.visibilityState === 'hidden';
        if (this.ctx && !this.disposed) {
          if (hidden) void this.ctx.suspend().catch(() => {});
          else {
            this._idleSuspended = false;
            this.lastActive = Date.now();
            void this.ctx.resume().catch(() => {});
          }
        }
        for (const l of this.visListeners) l(hidden);
      };
      document.addEventListener('visibilitychange', this.visHandler);
    }
    return true;
  }

  onVisibility(cb: (hidden: boolean) => void): () => void {
    this.visListeners.add(cb);
    return () => this.visListeners.delete(cb);
  }

  // ---------- volumes ----------
  setVolumes(v: Partial<Volumes>): void {
    this.vols = { ...this.vols, ...v };
    this.applyVolumes(false);
  }
  getVolumes(): Volumes {
    return { ...this.vols };
  }
  /** true se algo pode ser ouvido (usado para economizar CPU). */
  get audible(): boolean {
    return !this.vols.muted;
  }

  private applyVolumes(instant: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (g: GainNode, val: number) => {
      if (instant) g.gain.value = val;
      else g.gain.setTargetAtTime(val, t, 0.03);
    };
    set(this.master, this.vols.muted ? 0 : 1);
    set(this.musicBus, volCurve(this.vols.music) * 0.9);
    set(this.voiceBus, volCurve(this.vols.voice));
    set(this.sfxBus, volCurve(this.vols.sfx));
    if (instant) this.duck.gain.value = 1;
  }

  // ---------- ducking ----------
  /** Chamado pelo narrador quando começa/termina qualquer fala (clipe ou speechSynthesis). */
  setSpeaking(on: boolean): void {
    this.speaking = on;
    if (on) this.wake();
    if (!this.ctx) return;
    clearTimeout(this.releaseT);
    if (on) this.rampDuck(DUCK_LEVEL, DUCK_DOWN_S);
    else this.releaseT = setTimeout(() => this.rampDuck(1, DUCK_UP_S), DUCK_RELEASE_DELAY_MS);
  }

  private rampDuck(target: number, secs: number): void {
    if (!this.ctx) return;
    const p = this.duck.gain;
    const t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(target, t + secs);
  }

  // ---------- carregador ----------
  /** Enfileira ids para baixar em segundo plano (ordem = prioridade). Seguro chamar várias vezes. */
  preload(ids: readonly string[]): void {
    for (const id of ids) {
      if (this.queued.has(id) || this.raw.has(id) || this.missing.has(id)) continue;
      this.queued.add(id);
      this.queue.push(id);
    }
    this.pump();
  }

  private pump(): void {
    if (this.disposed || !this.fetchFn) return;
    if (!this.manifestP) this.manifestP = this.loadManifests();
    void this.manifestP.then(() => {
      // M4: sem nenhum manifest não há clipes publicados: nada de sondar ~400 URLs (cai no speechSynthesis)
      if (this.manifests && !this.manifests.gen && !this.manifests.custom) {
        for (const id of this.queue) this.missing.add(id);
        this.queue.length = 0;
        return;
      }
      while (this.inflight < FETCH_CONCURRENCY && this.queue.length) {
        const id = this.queue.shift()!;
        this.inflight++;
        this.fetchClip(id)
          .catch(() => {})
          .finally(() => {
            this.inflight--;
            this.pump();
          });
      }
    });
  }

  private async getJson(url: string): Promise<unknown | null> {
    try {
      const r = await this.fetchFn!(url);
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('html')) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  /** Manifests opcionais: evitam sondar arquivos inexistentes (404). */
  private async loadManifests(): Promise<void> {
    const parse = (j: any): Map<string, string[]> | null => {
      const list: unknown = Array.isArray(j) ? j : j?.ids ?? j?.files;
      if (!Array.isArray(list)) return null;
      const m = new Map<string, string[]>();
      for (const e of list) {
        if (typeof e !== 'string') continue;
        const dot = e.lastIndexOf('.');
        const id = dot > 0 ? e.slice(0, dot) : e;
        const arr = m.get(id) ?? [];
        if (dot > 0) arr.push(e);
        m.set(id, arr);
      }
      return m;
    };
    const [g, c] = await Promise.all([
      this.getJson(`${this.base}/voice/manifest.json`),
      this.getJson(`${this.base}/voice-custom/manifest.json`),
    ]);
    this.manifests = { gen: parse(g), custom: parse(c) };
  }

  private candidates(id: string): string[] {
    const out: string[] = [];
    // pasta sem manifest = pasta sem clipes (nunca sondar). O manifest lista só o que existe.
    const add = (dir: string, m: Map<string, string[]> | null) => {
      if (!m || !m.has(id)) return;
      const files = m.get(id)!;
      if (files.length) files.forEach((f) => out.push(`${this.base}/${dir}/${f}`));
      else this.exts.forEach((e) => out.push(`${this.base}/${dir}/${id}.${e}`));
    };
    add('voice-custom', this.manifests?.custom ?? null); // gravações da família vencem
    add('voice', this.manifests?.gen ?? null);
    return out;
  }

  private async fetchClip(id: string): Promise<void> {
    for (const url of this.candidates(id)) {
      try {
        const r = await this.fetchFn!(url);
        if (!r.ok) continue;
        if ((r.headers.get('content-type') ?? '').includes('html')) continue; // fallback de SPA
        const buf = await r.arrayBuffer();
        if (buf.byteLength < 64) continue;
        if (this.disposed) return;
        this.raw.set(id, buf);
        return;
      } catch {
        /* offline ou bloqueado: tenta o próximo */
      }
    }
    this.missing.add(id);
  }

  has(id: string): boolean {
    return this.unlocked && (this.decoded.has(id) || this.raw.has(id));
  }
  /** true se o clipe já foi baixado (independe do contexto). */
  isLoaded(id: string): boolean {
    return this.raw.has(id) || this.decoded.has(id);
  }
  get loadedCount(): number {
    return this.raw.size;
  }

  private decode(id: string): Promise<AudioBuffer | null> {
    const hit = this.decoded.get(id);
    if (hit) {
      this.decoded.delete(id);
      this.decoded.set(id, hit);
      return Promise.resolve(hit);
    }
    const pending = this.decoding.get(id);
    if (pending) return pending;
    const raw = this.raw.get(id);
    if (!raw || !this.ctx) return Promise.resolve(null);
    // callbacks + Promise (Chrome/WebView 60–72 e Safari antigo só têm a forma com callbacks)
    const p = decodeCompat(this.ctx, raw.slice(0))
      .then((b) => {
        if (this.disposed) return b;
        this.decoded.set(id, b);
        this.decodedBytes += bufBytes(b);
        this.evict(id);
        return b;
      })
      .catch(() => {
        this.raw.delete(id);
        this.missing.add(id);
        return null;
      })
      .finally(() => this.decoding.delete(id));
    this.decoding.set(id, p);
    return p;
  }

  /** Libera os menos usados (fora os fixados) até caber nos limites; `keep` nunca sai. */
  private evict(keep?: string): void {
    const over = () => this.decoded.size > this.limits.clips || this.decodedBytes > this.limits.bytes;
    if (!over()) return;
    for (const pass of [false, true]) {
      for (const [k, b] of this.decoded) {
        if (!over()) return;
        if (k === keep || (!pass && this.pinned.has(k))) continue;
        this.decoded.delete(k);
        this.decodedBytes -= bufBytes(b);
      }
    }
  }

  /** Quantos buffers decodificados estão vivos agora (para testes de memória). */
  get liveBuffers(): number {
    return this.decoded.size;
  }
  get liveBufferBytes(): number {
    return this.decodedBytes;
  }

  /** Decodifica antecipadamente (ocioso) para eliminar latência nas falas principais. */
  warm(ids: readonly string[], opts: { pin?: boolean } = {}): void {
    if (opts.pin) {
      for (const id of ids) this.pinned.add(id);
      while (this.pinned.size > 24) this.pinned.delete(this.pinned.values().next().value as string);
    }
    let i = 0;
    const step = () => {
      if (this.disposed || i >= ids.length) return;
      const id = ids[i++];
      const next = () => setTimeout(step, 30);
      if (this.raw.has(id) && !this.decoded.has(id) && this.ctx) void this.decode(id).then(next, next);
      else next();
    };
    step();
  }

  play(id: string): SpeechHandle | null {
    const ctx = this.ctx;
    if (!ctx || !this.has(id)) return null;
    this.wake();
    let stopped = false;
    let finished = false;
    let src: AudioBufferSourceNode | null = null;
    let safety: ReturnType<typeof setTimeout> | undefined;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const end = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safety);
      resolve();
    };
    const stop = () => {
      stopped = true;
      try {
        src?.stop();
      } catch {
        /* ok */
      }
      end();
    };
    // M12: contexto suspenso não avança o relógio → o clipe nunca "termina". Tenta retomar e arma um limite.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    safety = setTimeout(stop, DECODE_TIMEOUT_MS);
    void this.decode(id).then((buf) => {
      if (stopped || finished || !buf) return end();
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceBus);
      src.onended = () => {
        try {
          src?.disconnect();
        } catch {
          /* ok */
        }
        end();
      };
      clearTimeout(safety);
      safety = setTimeout(stop, buf.duration * 1000 + CLIP_SLACK_MS);
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      src.start();
    });
    return { done, stop };
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.releaseT);
    clearTimeout(this.idleT);
    this.idleT = undefined;
    if (this.visHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visHandler);
    }
    this.visListeners.clear();
    this.queue.length = 0;
    this.raw.clear();
    this.decoded.clear();
    this.decodedBytes = 0;
    this.pinned.clear();
    const c = this.ctx;
    this.ctx = null;
    if (c) void c.close().catch(() => {});
  }
}

function canPlayWebmOpus(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const a = document.createElement('audio');
    return a.canPlayType('audio/webm; codecs="opus"') !== '';
  } catch {
    return false;
  }
}

const bufBytes = (b: AudioBuffer): number => (b.length || Math.round(b.duration * b.sampleRate)) * (b.numberOfChannels || 1) * 4;
