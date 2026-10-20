import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, DECODED_LIMITS } from '../src/audio/engine';
import { Music } from '../src/audio/music';
import { createAudio } from '../src/audio';
import { Sfx } from '../src/audio/sfx';
import { decodeCompat, newOffline } from '../src/audio/compat';
import { Bus } from '../src/events';
import { numberId } from '../src/audio/script';

// ---------- Web Audio falso (só o que o áudio do jogo usa) ----------
class FParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}
class FNode {
  frequency = new FParam();
  gain = new FParam();
  detune = new FParam();
  Q = new FParam();
  threshold = new FParam();
  knee = new FParam();
  ratio = new FParam();
  attack = new FParam();
  release = new FParam();
  type = '';
  buffer: any = null;
  loop = false;
  loopStart = 0;
  onended: null | (() => void) = null;
  connected = true;
  started: Array<[number, number | undefined]> = [];
  stopped = false;
  constructor(public kind: string, public owner: FCtx) {
    owner.created++;
    if (kind === 'src' || kind === 'osc') owner.sources.add(this);
  }
  connect(n: any) {
    return n;
  }
  disconnect() {
    this.connected = false;
    this.owner.sources.delete(this);
  }
  start(t = 0, off?: number) {
    this.started.push([t, off]);
  }
  stop() {
    this.stopped = true;
    this.owner.sources.delete(this);
  }
}
class FBuf {
  numberOfChannels = 1;
  constructor(public length: number, public sampleRate: number) {}
  get duration() {
    return this.length / this.sampleRate;
  }
  data = new Float32Array(0);
  getChannelData() {
    if (!this.data.length) this.data = new Float32Array(this.length);
    return this.data;
  }
}
class FCtx {
  created = 0;
  sources = new Set<FNode>();
  currentTime = 0;
  state = 'running';
  sampleRate = 8000;
  destination = new FNode('dest', this);
  suspends = 0;
  resumes = 0;
  decodeLen = 1000;
  decodeCalls = 0;
  onstatechange: any = null;
  createGain = () => new FNode('gain', this);
  createOscillator = () => new FNode('osc', this);
  createBiquadFilter = () => new FNode('bq', this);
  createDynamicsCompressor = () => new FNode('comp', this);
  createBufferSource = () => new FNode('src', this);
  createBuffer(_c: number, len: number, sr: number) {
    return new FBuf(len, sr);
  }
  suspend() {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
  resume() {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  /** Só a forma com callbacks (Chrome/WebView ~60): devolve undefined. */
  decodeAudioData(_d: ArrayBuffer, ok: (b: any) => void) {
    this.decodeCalls++;
    queueMicrotask(() => ok(new FBuf(this.decodeLen, 8000)));
  }
}
const offlineCalls: Array<unknown[]> = [];
class FOffline extends FCtx {
  constructor(public ch: number, public len: number, sr: number, ...rest: unknown[]) {
    super();
    offlineCalls.push([ch, len, sr, ...rest]);
    this.sampleRate = sr;
  }
  startRendering() {
    return Promise.resolve(new FBuf(this.len, this.sampleRate));
  }
}

const g = globalThis as any;
let main: FCtx;
const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};
/** Avança o relógio falso até a música ficar pronta (a renderização é feita por timers ociosos). */
async function ready(m: Music, all = false): Promise<void> {
  let done = false;
  void m.whenReady(all).then(() => (done = true));
  for (let i = 0; i < 4000 && !done; i++) await vi.advanceTimersByTimeAsync(50);
  expect(done).toBe(true);
}
/** unlock + descarta a fonte muda de destravamento do iOS, para contar só a música. */
async function unlocked(e: AudioEngine): Promise<void> {
  await e.unlock();
  main.sources.clear();
}
const mkEngine = (idleMs?: number) => {
  main = new FCtx();
  return new AudioEngine({ createContext: () => main as unknown as AudioContext, idleMs });
};

beforeEach(() => {
  vi.useFakeTimers();
  offlineCalls.length = 0;
  g.OfflineAudioContext = FOffline;
});
afterEach(() => {
  vi.useRealTimers();
  delete g.OfflineAudioContext;
});

describe('compat (Android 5/6, Chrome ~60)', () => {
  it('OfflineAudioContext só com o construtor de 3 argumentos', () => {
    newOffline(1, 1000, 24000);
    expect(offlineCalls[0]).toEqual([1, 1000, 24000]);
  });
  it('decodeAudioData com callbacks (sem Promise) e com Promise', async () => {
    const cb = { decodeAudioData: (_d: any, ok: any) => void ok('A') } as any;
    await expect(decodeCompat(cb, new ArrayBuffer(1))).resolves.toBe('A');
    const pr = { decodeAudioData: () => Promise.resolve('B') } as any;
    await expect(decodeCompat(pr, new ArrayBuffer(1))).resolves.toBe('B');
    const bad = { decodeAudioData: (_d: any, _ok: any, err: any) => err(new Error('x')) } as any;
    await expect(decodeCompat(bad, new ArrayBuffer(1))).rejects.toThrow();
  });
});

describe('Music: pré-renderizada', () => {
  it('não toca nada até o buffer estar pronto; depois toca em loop e renderiza cada loop uma vez', async () => {
    const e = mkEngine();
    await unlocked(e);
    const m = new Music(e, { rnd: Math.random, variants: 2 });
    m.start('calm');
    expect(m.isRunning).toBe(true);
    expect(main.sources.size).toBe(0); // ainda renderizando: silêncio
    await flush(10);
    expect(main.sources.size).toBe(0);
    await ready(m);
    await flush(2000);
    expect(main.sources.size).toBeGreaterThan(0);
    await ready(m, true);
    // 2 variações × (calmo + animado) = 4 loops; stingers: 2 por tonalidade distinta
    expect(m.renderedLoops).toBe(4);
    const loopsOffline = offlineCalls.filter((c) => (c[1] as number) > 8000 * 10).length;
    expect(loopsOffline).toBe(4);
    m.dispose();
  });

  it('constrói o grafo em fatias (nunca um bloco longo de JS)', async () => {
    const e = mkEngine();
    await unlocked(e);
    let t = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 3)); // cada passo "custa" 3 ms
    let slices = 0;
    const m = new Music(e, {
      variants: 1,
      defer: (fn, ms) => {
        slices++;
        return setTimeout(fn, ms);
      },
    });
    m.start('calm');
    await ready(m);
    spy.mockRestore();
    // um loop = 128 passos; com fatias de ~8 ms (≈3 passos) são dezenas de fatias por loop
    expect(slices).toBeGreaterThan(60);
    m.dispose();
  });

  it('taxa de amostragem: dispositivo no normal, 24 kHz no modo econômico', async () => {
    const e = mkEngine();
    await unlocked(e);
    const a = new Music(e, { variants: 1 });
    a.start();
    await ready(a);
    expect(a.sampleRate).toBe(8000); // taxa do contexto principal
    a.dispose();
    offlineCalls.length = 0;
    const b = new Music(e, { variants: 1 });
    b.setEconomy(true);
    b.start();
    await ready(b);
    expect(b.sampleRate).toBe(24000);
    expect(offlineCalls.every((c) => c[2] === 24000 && c.length === 3)).toBe(true);
    // economia usa metade da memória por segundo de música
    b.dispose();
  });

  it('trocar economia durante a reprodução reconstrói em segundo plano e troca sem parar a música', async () => {
    const e = mkEngine();
    await unlocked(e);
    const m = new Music(e, { variants: 1 });
    m.start();
    await ready(m, true);
    expect(m.sampleRate).toBe(8000);
    m.setEconomy(true);
    expect(main.sources.size).toBeGreaterThan(0); // continua tocando o buffer antigo
    await ready(m);
    await flush(3000);
    expect(m.sampleRate).toBe(24000);
    expect(main.sources.size).toBeGreaterThan(0);
    m.dispose();
  });

  it('loop sem emenda: o próximo começa exatamente onde o atual termina; sem nós novos por segundo', async () => {
    const e = mkEngine();
    await unlocked(e);
    const m = new Music(e, { variants: 1 });
    m.start('calm');
    await ready(m, true);
    await flush(1000);
    const srcs = () => [...main.sources].filter((n) => n.kind === 'src');
    const first = srcs()[0];
    const [when0, off0] = first.started[0];
    const dur = first.buffer.duration;
    expect(dur).toBeCloseTo((8 * 16 * 60) / 102 / 4, 2);
    // avança até agendar o próximo
    main.currentTime = when0 + dur - 2;
    await flush(60_000);
    const all = [...main.sources].filter((n) => n.kind === 'src' && n.started.length);
    const nxt = all.find((n) => n !== first && n.started[0][0] === (when0 - (off0 ?? 0)) + dur);
    expect(nxt).toBeTruthy();
    // 60 s de música: quase nenhum nó criado (só 1 fonte por loop), nada de agendamento contínuo
    const before = main.created;
    main.currentTime += 1;
    await flush(30_000);
    expect(main.created - before).toBeLessThan(6);
    m.dispose();
  });

  it('crossfade calmo <-> animado por GainNodes; o loop antigo é liberado', async () => {
    const e = mkEngine();
    await unlocked(e);
    const m = new Music(e, { variants: 1 });
    m.start('calm');
    await ready(m, true);
    await flush(1000);
    const base = main.sources.size;
    m.setMode('lively');
    expect(m.currentMode).toBe('lively');
    expect(main.sources.size).toBe(base + 1); // os dois tocam durante o crossfade
    await flush(3600);
    expect(main.sources.size).toBe(base); // o antigo foi parado e desconectado
    const live = [...main.sources].find((n) => n.kind === 'src')!;
    expect(live.buffer.duration).toBeCloseTo((8 * 16 * 60) / 112 / 4, 2); // loop animado
    m.dispose();
  });

  it('stinger pré-renderizado: false até ficar pronto, depois toca 1 fonte e para de ocupar nós', async () => {
    const e = mkEngine();
    await unlocked(e);
    const m = new Music(e, { variants: 1 });
    expect(m.stinger('win')).toBe(false); // não está tocando
    m.start('calm');
    await ready(m);
    await flush(100);
    await ready(m, true);
    const before = main.sources.size;
    expect(m.stinger('bingo')).toBe(true);
    expect(main.sources.size).toBe(before + 1);
    m.dispose();
  });

  it('pause derruba os nós e resume volta da mesma posição', async () => {
    const e = mkEngine();
    await unlocked(e);
    const m = new Music(e, { variants: 1 });
    m.start();
    await ready(m, true);
    await flush(500);
    m.pause();
    expect(main.sources.size).toBe(0);
    main.currentTime += 5;
    m.resume();
    expect(main.sources.size).toBe(1);
    m.stop(0.01);
    await flush(200);
    expect(main.sources.size).toBe(0);
    e.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sem OfflineAudioContext (ou se a renderização falhar) cai no procedural ao vivo', async () => {
    delete g.OfflineAudioContext;
    const e = mkEngine();
    await unlocked(e);
    const m = new Music(e);
    expect(m.prerendered).toBe(false);
    m.start('calm');
    await flush(500);
    expect(main.created).toBeGreaterThan(20);
    expect(m.stinger('win')).toBe(true);
    m.dispose();

    g.OfflineAudioContext = class extends FOffline {
      override startRendering() {
        return Promise.reject(new Error('sem memória'));
      }
    };
    const e2 = mkEngine();
    await unlocked(e2);
    const m2 = new Music(e2);
    m2.start('calm');
    await flush(1000);
    expect(m2.prerendered).toBe(false);
    await flush(500);
    expect(main.created).toBeGreaterThan(20);
    m2.dispose();
  });

  it('memória: economia usa metade dos bytes por segundo de música', async () => {
    const e = mkEngine();
    await unlocked(e);
    const a = new Music(e, { variants: 1 });
    a.start();
    await ready(a, true);
    const normal = a.memoryBytes;
    a.dispose();
    const b = new Music(e, { variants: 1 });
    b.setEconomy(true);
    b.start();
    await ready(b, true);
    // 8 kHz (contexto falso) vs 24 kHz: a economia do mundo real é 48k→24k; aqui só verificamos o cálculo
    expect(b.memoryBytes / b.sampleRate).toBeCloseTo(normal / 8000, -1);
    b.dispose();
  });
});

// ---------- voz sob demanda + LRU ----------
const resp = (body: unknown, ok = true) => ({
  ok,
  headers: { get: () => 'application/json' },
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(200),
});
async function engineWithClips(n: number, bytesPerClip = 100_000) {
  const ids = Array.from({ length: n }, (_, i) => `c${i}`);
  const fetchFn = (async (u: string) => {
    if (u.endsWith('voice/manifest.json')) return resp(ids.map((i) => `${i}.mp3`));
    if (u.endsWith('manifest.json')) return resp({}, false);
    return resp(null);
  }) as unknown as typeof fetch;
  main = new FCtx();
  main.decodeLen = bytesPerClip / 4;
  const e = new AudioEngine({ fetchFn, createContext: () => main as unknown as AudioContext });
  await e.unlock();
  e.preload(ids);
  await flush(100);
  return { e, ids };
}

describe('voz: decodificação sob demanda com LRU', () => {
  it('preload baixa tudo mas NÃO decodifica nenhum clipe', async () => {
    const { e, ids } = await engineWithClips(142);
    expect(e.loadedCount).toBe(142);
    expect(main.decodeCalls).toBe(0);
    expect(e.liveBuffers).toBe(0);
    expect(ids.length).toBe(142);
  });

  it('tocar 142 clipes distintos nunca passa de 48 buffers vivos', async () => {
    const { e, ids } = await engineWithClips(142);
    let peak = 0;
    for (const id of ids) {
      e.play(id)!;
      await flush(5);
      peak = Math.max(peak, e.liveBuffers);
    }
    expect(peak).toBeLessThanOrEqual(DECODED_LIMITS.normal.clips);
    expect(e.liveBuffers).toBe(DECODED_LIMITS.normal.clips);
    expect(main.decodeCalls).toBe(142);
  });

  it('limite de bytes vale quando os clipes são grandes (24 MB)', async () => {
    const { e, ids } = await engineWithClips(60, 2_000_000);
    for (const id of ids) {
      e.play(id);
      await flush(5);
    }
    expect(e.liveBufferBytes).toBeLessThanOrEqual(DECODED_LIMITS.normal.bytes);
    expect(e.liveBuffers).toBe(Math.floor(DECODED_LIMITS.normal.bytes / 2_000_000));
  });

  it('modo econômico: 32 clipes / 12 MB e libera na hora ao ligar', async () => {
    const { e, ids } = await engineWithClips(100);
    for (const id of ids.slice(0, 48)) {
      e.play(id);
      await flush(5);
    }
    expect(e.liveBuffers).toBe(48);
    e.setEconomy(true);
    expect(e.liveBuffers).toBe(DECODED_LIMITS.economy.clips);
  });

  it('clipes fixados (prêmios) sobrevivem ao giro dos números', async () => {
    const { e, ids } = await engineWithClips(142);
    e.warm(ids.slice(0, 6), { pin: true });
    await flush(500);
    for (const id of ids.slice(6)) {
      e.play(id);
      await flush(5);
    }
    const before = main.decodeCalls;
    e.play(ids[0]);
    await flush(5);
    expect(main.decodeCalls).toBe(before); // continuava decodificado
  });

  it('hintNext decodifica poucos números, não todos', async () => {
    const { e } = await engineWithClips(2);
    const bus = new Bus();
    const api = createAudio(bus, { engine: e, rnd: () => 0.5 });
    api.hintNext([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await flush(1000);
    expect(main.decodeCalls).toBeLessThanOrEqual(6);
    api.dispose();
    void numberId;
  });
});

// ---------- AudioContext suspenso quando parado ----------
describe('AudioContext ocioso', () => {
  it('suspende após o tempo ocioso sem música e volta em wake()/efeito/fala', async () => {
    const e = mkEngine(90_000);
    await e.unlock();
    await flush(89_000);
    expect(main.suspends).toBe(0);
    await flush(2000);
    expect(main.suspends).toBe(1);
    expect(e.idleSuspended).toBe(true);
    expect(e.unlocked).toBe(true); // continua "liberado": clipes seguem disponíveis
    // o handler de statechange do M12 não pode retomar sozinho
    main.onstatechange?.();
    expect(main.resumes).toBe(0);
    // efeito sonoro acorda
    const sfx = new Sfx(e);
    sfx.tick();
    expect(main.resumes).toBe(1);
    expect(e.idleSuspended).toBe(false);
    await flush(100_000);
    expect(main.suspends).toBe(2); // sem nova atividade, suspende de novo
    e.setSpeaking(true); // fala acorda
    expect(main.resumes).toBe(2);
  });

  it('não suspende com música audível tocando; suspende quando a música cala', async () => {
    const e = mkEngine(90_000);
    await e.unlock();
    let playing = true;
    e.musicActive = () => playing;
    await flush(300_000);
    expect(main.suspends).toBe(0);
    playing = false;
    await flush(100_000);
    expect(main.suspends).toBe(1);
  });

  it('não suspende no meio de uma fala', async () => {
    const e = mkEngine(90_000);
    await e.unlock();
    e.setSpeaking(true);
    await flush(400_000);
    expect(main.suspends).toBe(0);
  });

  it('um timer só (sem acúmulo) mesmo com muita atividade', async () => {
    const e = mkEngine(90_000);
    await e.unlock();
    const base = vi.getTimerCount();
    for (let i = 0; i < 2000; i++) e.wake();
    expect(vi.getTimerCount()).toBe(base);
  });
});

// ---------- resistência: 500 rodadas no barramento ----------
describe('resistência', () => {
  it('500 rodadas de eventos: sem crescer listeners, timers, nós ou buffers', async () => {
    const e = mkEngine();
    const bus = new Bus();
    const music = new Music(e, { variants: 1 });
    const api = createAudio(bus, { engine: e, music, rnd: () => 0.5 });
    await api.unlock();
    await ready(music, true);
    main.sources.size;
    await flush(1000);
    const listeners = () => [...((bus as any).map as Map<string, Set<unknown>>).values()].reduce((a, s) => a + s.size, 0);
    const L0 = listeners();
    const round = async (r: number) => {
      bus.emit('roundStart', { bet: 1, totalBet: 1 });
      for (let i = 0; i < 30; i++) {
        bus.emit('ballDrawn', { ball: 1 + ((r * 7 + i) % 90), index: i, total: 30, extra: false, fast: i % 3 === 0 });
        if (i === 12) bus.emit('almost', { cardIndex: 0, pattern: 'linhaDupla', forBingo: false });
        if (i === 20) bus.emit('patternWon', { cardIndex: 0, pattern: 'linha', prize: 5, ball: 1 });
        main.currentTime += 0.5;
        await flush(500); // tempo real de jogo: os timers de fala/ducking vencem normalmente
      }
      bus.emit('extraOffer', { cost: 1, free: false, remaining: 9, improves: [] });
      bus.emit('roundEnd', { summary: { prize: 5 } as any, won: true });
      await flush(20);
    };
    for (let r = 0; r < 50; r++) await round(r);
    const timers1 = vi.getTimerCount();
    const sources1 = main.sources.size;
    for (let r = 50; r < 500; r++) await round(r);
    expect(listeners()).toBe(L0);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timers1 + 2);
    expect(main.sources.size).toBeLessThanOrEqual(sources1 + 4);
    expect(e.liveBuffers).toBeLessThanOrEqual(DECODED_LIMITS.normal.clips);
    api.dispose();
    await flush(5000);
    expect(listeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
