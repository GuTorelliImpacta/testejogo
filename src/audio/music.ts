// Música PROCEDURAL original: groove brasileiro leve (bossa/samba-jazz suave), 102–112 BPM.
// Violão e cavaquinho sintetizados, piano elétrico (FM), baixo, marimba e percussão leve.
//
// v3 (leve para tablet fraco): cada loop de 8 compassos é renderizado UMA vez com OfflineAudioContext
// (em tempo ocioso, em fatias de ≤ ~8 ms de JS) e tocado como AudioBuffer encadeado sem emenda.
// Calmo e animado são buffers separados (mesma harmonia) com crossfade por GainNodes; os stingers também
// são pré-renderizados (um por tonalidade). Se o aparelho não tem OfflineAudioContext (ou a renderização
// falha), cai no sequenciador procedural ao vivo (agendamento com lookahead, igual ao da v2).
import type { AudioEngine } from './engine';
import { canPrerender, newOffline, renderCompat } from './compat';
import { Voices, midiHz, noiseHit, tone } from './synth';

export type MusicMode = 'calm' | 'lively';
export type StingerKind = 'win' | 'bingo';

const STEPS = 16;
const BARS = 8;
const LOOKAHEAD = 0.4;
const TICK_MS = 110;
const BPM = { calm: 102, lively: 112 } as const;
const SWING = 0.07;

const QUAL: Record<string, number[]> = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  '9': [0, 4, 7, 10, 14],
  '6': [0, 4, 7, 9],
  m7b5: [0, 3, 6, 10],
};
// token → [semitons acima da tônica, qualidade]
const TOK: Record<string, [number, string]> = {
  Imaj7: [0, 'maj7'], I6: [0, '6'], I9: [0, 'maj9'],
  ii7: [2, 'm7'], iii7: [4, 'm7'], IVmaj7: [5, 'maj7'], iv7: [5, 'm7'],
  V7: [7, '7'], V9: [7, '9'], vi7: [9, 'm7'], VI7: [9, '7'], II7: [2, '7'],
  bVII7: [10, '7'], bIIImaj7: [3, 'maj7'], sivm7b5: [6, 'm7b5'], bII7: [1, '7'],
};
// 8 compassos; "a b" = dois acordes no compasso
const PROGS: string[][] = [
  ['Imaj7', 'vi7', 'ii7', 'V7', 'Imaj7', 'VI7', 'ii7', 'V7'],
  ['Imaj7', 'IVmaj7', 'iii7 VI7', 'ii7 V7', 'Imaj7', 'IVmaj7', 'ii7', 'V9'],
  ['I6', 'sivm7b5', 'iii7', 'VI7', 'ii7', 'V9', 'Imaj7', 'bVII7'],
  ['Imaj7', 'II7', 'ii7', 'V7', 'iii7', 'VI7', 'ii7 V7', 'I9'],
  ['Imaj7', 'bIIImaj7', 'IVmaj7', 'iv7', 'Imaj7 vi7', 'ii7 V7', 'I6', 'V7'],
  ['ii7', 'V7', 'Imaj7', 'IVmaj7', 'ii7', 'bII7', 'I9', 'vi7 V7'],
];
const KEYS = [0, 5, 7, 2, 10]; // C F G D Bb

interface Chord { pc: number; iv: number[] }
type Pat = Record<number, string>;

const BASS_CALM: Pat[] = [
  { 0: 'r', 6: 'f', 8: 'r', 14: 'f' },
  { 0: 'r', 6: 'f', 10: 'o', 14: 'f' },
  { 0: 'r', 8: 'f', 11: 'o' },
];
const BASS_LIVELY: Pat[] = [
  { 0: 'r', 3: 'f', 6: 'o', 8: 'r', 11: 'f', 14: 't' },
  { 0: 'r', 2: 'r', 6: 'f', 8: 'r', 10: 'o', 14: 't' },
];
const GTR_CALM = [[0, 3, 6, 10, 13], [0, 6, 8, 14], [0, 3, 8, 11]];
const GTR_LIVELY = [[2, 6, 10, 14], [0, 3, 6, 9, 12], [0, 4, 6, 10, 12, 14]];
const CLAVE = [0, 3, 6, 10, 12];
const CELLS = [[2, 4, 6], [6, 8, 10, 12], [10, 12, 14], [0, 3, 6, 8], [4, 7, 10], [3, 6, 8, 11, 14]];

/** Voicing ascendente: cada nota é a mais grave ≥ anterior+1 com o pitch class pedido. */
function stack(rootPc: number, iv: number[], order: number[], lowest: number): number[] {
  const out: number[] = [];
  let prev = lowest - 1;
  for (const k of order) {
    const idx = Math.min(k, iv.length - 1);
    const pc = (rootPc + iv[idx]) % 12;
    let m = prev + 1;
    while (m % 12 !== pc) m++;
    out.push(m);
    prev = m;
  }
  return out;
}


// ---------- plano de uma seção (8 compassos = 1 loop) ----------
interface Section {
  progIdx: number;
  key: number;
  prog: Chord[][];
  bassPat: Pat;
  bassPatL: Pat;
  gtrCalm: number[];
  gtrLively: number[];
  epStyle: number;
}

/** Sorteia progressão, tonalidade e padrões (mesma lógica da v2). `avoid` = progressões a não repetir. */
function makeSection(rnd: () => number, avoid: readonly number[], prevKey: number): Section {
  const ri = (n: number) => Math.floor(rnd() * n);
  let p = ri(PROGS.length);
  for (let i = 0; avoid.includes(p) && i < PROGS.length; i++) p = (p + 1) % PROGS.length;
  let key = prevKey;
  if (prevKey < 0) key = KEYS[ri(KEYS.length)];
  else if (rnd() < 0.4) {
    let k = KEYS[ri(KEYS.length)];
    if (k === key) k = KEYS[(KEYS.indexOf(k) + 1) % KEYS.length];
    key = k;
  }
  const prog = PROGS[p].map((bar) =>
    bar.split(' ').map((tk) => {
      const [off, q] = TOK[tk];
      return { pc: (key + off) % 12, iv: QUAL[q] };
    }),
  );
  return {
    progIdx: p,
    key,
    prog,
    bassPat: BASS_CALM[ri(BASS_CALM.length)],
    bassPatL: BASS_LIVELY[ri(BASS_LIVELY.length)],
    gtrCalm: GTR_CALM[ri(GTR_CALM.length)],
    gtrLively: GTR_LIVELY[ri(GTR_LIVELY.length)],
    epStyle: ri(2),
  };
}

// ---------- instrumentos ----------
function bass(v: Voices, d: AudioNode, t: number, m: number, g: number, dur: number): void {
  const f = midiHz(m);
  tone(v, d, { type: 'triangle', freq: f, t, dur, gain: g, attack: 0.008, cutoff: [900, 260] });
  tone(v, d, { type: 'sine', freq: f, t, dur: dur * 0.8, gain: g * 0.5, attack: 0.008 });
}
function pluck(v: Voices, d: AudioNode, t: number, m: number, g: number, dur: number): void {
  tone(v, d, { type: 'sawtooth', freq: midiHz(m), t, dur, gain: g, attack: 0.002, cutoff: [3400, 520] });
}
function cavaco(v: Voices, d: AudioNode, t: number, m: number, g: number): void {
  tone(v, d, { type: 'sawtooth', freq: midiHz(m), t, dur: 0.13, gain: g, attack: 0.002, cutoff: [6500, 1800] });
}
function marimba(v: Voices, d: AudioNode, t: number, m: number, g: number): void {
  const f = midiHz(m);
  tone(v, d, { freq: f, t, dur: 0.55, gain: g });
  tone(v, d, { freq: f * 4, t, dur: 0.12, gain: g * 0.3 });
}
/** Piano elétrico FM (tine): portadora + modulador 1:1 com índice decaindo. */
function epiano(v: Voices, d: AudioNode, t: number, m: number, g: number, dur: number): void {
  const ctx = v.ctx;
  const f = midiHz(m);
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const mg = ctx.createGain();
  const og = ctx.createGain();
  car.frequency.value = f;
  mod.frequency.value = f;
  mg.gain.setValueAtTime(f * 1.1, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.5);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.linearRampToValueAtTime(g, t + 0.005);
  og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
  mod.connect(mg);
  mg.connect(car.frequency);
  car.connect(og);
  og.connect(d);
  v.run(mod, t, dur + 0.4, [mg]);
  v.run(car, t, dur + 0.4, [og]);
}
function brass(v: Voices, d: AudioNode, t: number, tonic: number, dur: number, long = false): void {
  for (const o of [0, 4, 7, 12]) {
    for (const det of [-6, 6]) {
      tone(v, d, {
        type: 'sawtooth',
        freq: midiHz(tonic + o),
        detune: det,
        t,
        dur: dur + (long ? 0.9 : 0.15),
        gain: 0.045,
        attack: 0.025,
        cutoff: [900, 3200],
      });
    }
  }
}

// ---------- construtor de seção (serve ao render offline e ao modo procedural ao vivo) ----------
interface BuildCfg {
  v: Voices;
  calm: AudioNode;
  lively: AudioNode;
  sec: Section;
  rnd: () => number;
  mode: () => MusicMode;
  livelyOn: () => boolean;
  t0: number;
  melIdx?: number;
}

class SectionBuilder {
  step = 0;
  bar = 0;
  nextT: number;
  melIdx: number;
  private melCell: number[] = [];
  private bpm: number = BPM.calm;

  constructor(private c: BuildCfg) {
    this.nextT = c.t0;
    this.melIdx = c.melIdx ?? 0;
  }

  get done(): boolean {
    return this.bar >= BARS;
  }

  private ri(n: number): number {
    return Math.floor(this.c.rnd() * n);
  }

  scheduleStep(): void {
    const { v, sec, rnd } = this.c;
    const s = this.step;
    if (s === 0) {
      this.bpm = BPM[this.c.mode()];
      this.melCell = rnd() < (this.c.mode() === 'lively' ? 0.7 : 0.3) ? CELLS[this.ri(CELLS.length)] : [];
    }
    const sd = 60 / this.bpm / 4;
    const t = this.nextT + (s % 2 === 1 ? SWING * sd : 0);
    const cs = sec.prog[this.bar];
    const ch = cs.length === 1 ? cs[0] : cs[s < 8 ? 0 : 1];
    const lively = this.c.livelyOn();
    const bus = this.c.calm;
    const lbus = this.c.lively;

    // baixo
    const bk = (lively ? sec.bassPatL : sec.bassPat)[s];
    if (bk) {
      const root = 28 + ((ch.pc - 28 + 120) % 12);
      const m = bk === 'r' ? root : bk === 'f' ? root + 7 : bk === 'o' ? root + 12 : root + ch.iv[1];
      bass(v, bus, t, m > 47 ? m - 12 : m, bk === 'r' ? 0.55 : 0.42, sd * (bk === 'r' ? 5 : 3));
    }

    // violão
    const gp = lively ? sec.gtrLively : sec.gtrCalm;
    if (gp.includes(s)) {
      const notes = stack(ch.pc, ch.iv, [0, 2, 3, 1], 45);
      notes.forEach((m, i) => pluck(v, bus, t + i * 0.011, m, s === gp[0] ? 0.17 : 0.12, 0.45));
    }

    // piano elétrico
    if (s === 0 || (s === 8 && sec.epStyle === 1) || (s === 10 && rnd() < 0.5)) {
      const notes = stack(ch.pc, ch.iv, ch.iv.length > 4 ? [1, 3, 4] : [1, 3, 2], 50);
      const dur = s === 0 ? sd * 10 : sd * 3;
      notes.forEach((m, i) => epiano(v, bus, t + i * 0.008, m, (s === 0 ? 0.11 : 0.08) / (1 + i * 0.2), dur));
    }

    // marimba (melodia leve)
    const ci = this.melCell.indexOf(s);
    if (ci >= 0) {
      const allowed = new Set([...ch.iv.map((x) => (ch.pc + x) % 12), (ch.pc + 2) % 12]);
      const cand: number[] = [];
      for (let m = 67; m <= 86; m++) if (allowed.has(m % 12)) cand.push(m);
      this.melIdx = Math.max(0, Math.min(cand.length - 1, (this.melIdx || cand.length >> 1) + this.ri(5) - 2));
      marimba(v, lively ? lbus : bus, t, cand[Math.min(this.melIdx, cand.length - 1)], lively ? 0.1 : 0.07);
    }

    // percussão
    if (s % 2 === 0) noiseHit(v, bus, { t, dur: 0.05, gain: s % 8 === 0 ? 0.05 : 0.03, filter: 'highpass', freq: 6500 });
    if (CLAVE.includes(s)) noiseHit(v, bus, { t, dur: 0.035, gain: 0.07, filter: 'bandpass', freq: 1900, q: 4 });
    if (s === 0 || s === 8) tone(v, bus, { freq: 110, glideTo: 46, t, dur: 0.2, gain: s === 0 ? 0.3 : 0.22 });
    if (lively) {
      if (s % 2 === 1 || s % 4 === 2) noiseHit(v, lbus, { t, dur: 0.045, gain: 0.03, filter: 'highpass', freq: 7000 });
      if (s === 8) tone(v, lbus, { freq: 95, glideTo: 58, t, dur: 0.3, gain: 0.4 });
      if (s === 0 || s === 15) tone(v, lbus, { freq: 80, glideTo: 55, t, dur: 0.18, gain: 0.16 });
      if (s === 4 || s === 7 || s === 10 || s === 14) {
        noiseHit(v, lbus, { t, dur: 0.07, gain: 0.07, filter: 'bandpass', freq: 3200, q: 1.5 });
        if (s === 4 || s === 10) noiseHit(v, lbus, { t, dur: 0.12, gain: 0.025, filter: 'highpass', freq: 8000 });
      }
      if (s % 2 === 0 || s === 3 || s === 7 || s === 11) {
        const notes = stack(ch.pc, ch.iv, [1, 2, 3], 68);
        notes.forEach((m, i) => cavaco(v, lbus, t + i * 0.006, m, s % 4 === 0 ? 0.075 : 0.045));
      }
    }

    // avança
    this.nextT += sd;
    if (++this.step >= STEPS) {
      this.step = 0;
      this.bar++;
    }
  }
}

// ---------- stinger (3–6 s, na tonalidade da seção) ----------
const STING_BPM = 116;
const stingLen = (big: boolean): number => (big ? 22 : 14);
/** Duração "musical" (até o fim da cauda do acorde final), em segundos. */
const stingTotal = (big: boolean): number => stingLen(big) * (60 / STING_BPM / 4) + 1.8;

/** O stinger como lista de pequenas tarefas (o render offline as executa em fatias; ao vivo, todas de uma vez). */
function stingerTasks(v: Voices, sb: AudioNode, t0: number, key: number, big: boolean): Array<() => void> {
  const q: Array<() => void> = [];
  const sd = 60 / STING_BPM / 4;
  const tonic = 60 + (key > 6 ? key - 12 : key);
  const T = (i: number) => t0 + i * sd;
  const mel = big
    ? [[0, 6], [4, 7], [7, 8], [12, 9], [9, 11], [14, 12], [16, 13], [12, 14], [19, 15], [16, 16], [24, 18]]
    : [[0, 0], [4, 1], [7, 2], [12, 3], [9, 5], [16, 6], [14, 8]];
  // chamada em 3 batidas + fim sustentado (bingo)
  if (big) {
    [0, 2, 4].forEach((i) => q.push(() => brass(v, sb, T(i), tonic, sd * 1.6)));
    q.push(() => brass(v, sb, T(6), tonic, sd * 5, true));
    q.push(() => {
      tone(v, sb, { freq: 100, glideTo: 50, t: T(0), dur: 0.3, gain: 0.5 });
      noiseHit(v, sb, { t: T(6), dur: 0.9, gain: 0.07, filter: 'highpass', freq: 5000, attack: 0.03 });
    });
  }
  for (const [off, i] of mel) {
    q.push(() => {
      const m = tonic + 12 + off;
      marimba(v, sb, T(i), m, 0.16);
      if (i % 2 === 0) epiano(v, sb, T(i), m - 12, 0.1, sd * 2);
    });
  }
  // samba: surdo, shaker e pandeiro
  const len = stingLen(big);
  for (let i = 0; i < len; i++) {
    q.push(() => {
      const t = T(i);
      noiseHit(v, sb, { t, dur: 0.05, gain: 0.05, filter: 'highpass', freq: 7000 });
      if (i % 8 === 0 || (i > 8 && i % 8 === 4)) tone(v, sb, { freq: 95, glideTo: 58, t, dur: 0.28, gain: 0.45 });
      if (i % 4 === 2) noiseHit(v, sb, { t, dur: 0.07, gain: 0.08, filter: 'bandpass', freq: 3200, q: 1.5 });
    });
  }
  // acorde final (Imaj9) em violão + piano + marimba
  const endI = big ? 18 : 10;
  [0, 4, 7, 11, 14].forEach((o, i) =>
    q.push(() => {
      pluck(v, sb, T(endI) + i * 0.012, tonic - 12 + o, 0.2, 1.6);
      epiano(v, sb, T(endI) + i * 0.01, tonic + o, 0.1, 1.6);
    }),
  );
  q.push(() => {
    marimba(v, sb, T(endI), tonic + 24, 0.14);
    bass(v, sb, T(endI), 28 + ((tonic - 28 + 120) % 12), 0.6, 1.4);
  });
  return q;
}
function buildStinger(v: Voices, sb: AudioNode, t0: number, key: number, big: boolean): void {
  for (const f of stingerTasks(v, sb, t0, key, big)) f();
}

// ---------- biblioteca pré-renderizada ----------
const LOOP_TAIL_S = 1.2; // cauda dobrada sobre o início → loop sem emenda
const SLICE_MS = 5; // CPU de JS por fatia de construção do grafo (bem abaixo de 50 ms)
const SLICE_GAP_MS = 12;
const TASK_GAP_MS = 150; // entre as tarefas da 1ª variação (a música precisa estar pronta logo)
const LATER_GAP_MS = 1500; // depois disso, espaça o trabalho nativo para não competir com o jogo
const START_DELAY_MS = 200;
const ECONOMY_SR = 24000;
const XFADE_TAU = 0.6;
const NEXT_LEAD_S = 2.5;

interface Variant {
  sec: Section;
  calm: AudioBuffer | null;
  lively: AudioBuffer | null;
}
interface Sting {
  buf: AudioBuffer;
  total: number;
}
interface Lib {
  sr: number;
  n: number;
  variants: Variant[];
  stingers: Map<string, Sting>;
  done: boolean;
}
interface Seg {
  src: AudioBufferSourceNode;
  start: number; // instante (ctx) em que o offset 0 tocaria
  end: number;
  dur: number;
  vi: number;
  key: number;
}
interface Chain {
  mode: MusicMode;
  g: GainNode;
  cur: Seg;
  nxt: Seg | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  dead: boolean;
}

export interface MusicOptions {
  rnd?: () => number;
  /** false força o modo procedural ao vivo (v2). Padrão: pré-renderiza se o aparelho suportar. */
  prerender?: boolean;
  /** Variações (harmonias) pré-renderizadas; padrão 3 (2 no modo econômico). */
  variants?: number;
  /** Agenda trabalho ocioso (padrão setTimeout). A prévia WAV injeta o relógio real. */
  defer?: (fn: () => void, ms: number) => unknown;
}

const bufBytes = (b: AudioBuffer): number => b.length * b.numberOfChannels * 4;

export class Music {
  private ctx: AudioContext | null = null;
  private out!: GainNode; // fade geral
  private bed!: GainNode; // abaixa durante stinger
  private unsub: (() => void) | null = null;
  private stopT: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private paused = false;
  private mode: MusicMode = 'calm';
  private rnd: () => number;
  private eco = false;
  private disposed = false;
  private rampedIn = false;

  // pré-renderização
  private usePre: boolean;
  private lib: Lib | null = null;
  private building: Lib | null = null;
  private tok = 0;
  private waiters: Array<() => void> = [];
  private readyWaiters: Array<{ all: boolean; res: () => void }> = [];
  private chain: Chain | null = null;
  private retiring = new Set<Chain>();
  private retireTimers = new Set<ReturnType<typeof setTimeout>>();
  private savedFrac = 0;
  private savedVi = 0;

  // modo procedural ao vivo (fallback)
  private voices: Voices | null = null;
  private calmBus: GainNode | null = null;
  private livelyBus: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private livelyOff: ReturnType<typeof setTimeout> | undefined;
  private livelyOn = false;
  private nextT = 0;
  private lb: SectionBuilder | null = null;
  private liveSec: Section | null = null;

  constructor(
    private engine: AudioEngine,
    private o: MusicOptions = {},
  ) {
    this.rnd = o.rnd ?? Math.random;
    this.usePre = o.prerender !== false && canPrerender();
  }

  get isRunning(): boolean {
    return this.running;
  }
  /** true se está tocando de verdade (ligada e não pausada). */
  get isPlaying(): boolean {
    return this.running && !this.paused;
  }
  get currentMode(): MusicMode {
    return this.mode;
  }
  /** true quando a trilha toca de buffers pré-renderizados (false = procedural ao vivo). */
  get prerendered(): boolean {
    return this.usePre;
  }
  get economy(): boolean {
    return this.eco;
  }
  /** Memória (bytes) dos buffers pré-renderizados vivos. */
  get memoryBytes(): number {
    const l = this.lib;
    let n = 0;
    if (l) {
      for (const v of l.variants) n += (v.calm ? bufBytes(v.calm) : 0) + (v.lively ? bufBytes(v.lively) : 0);
      for (const s of l.stingers.values()) n += bufBytes(s.buf);
    }
    return n;
  }
  get renderedLoops(): number {
    return this.lib ? this.lib.variants.reduce((a, v) => a + (v.calm ? 1 : 0) + (v.lively ? 1 : 0), 0) : 0;
  }
  get sampleRate(): number {
    return this.lib?.sr ?? 0;
  }

  /** Modo econômico: render em 24 kHz e menos variações. Pode ser chamado a qualquer hora. */
  setEconomy(on: boolean): void {
    if (on === this.eco) return;
    this.eco = on;
    if (!this.usePre) return;
    if (!this.running) {
      // libera memória; refaz na taxa certa no próximo start()
      this.tok++;
      this.lib = null;
      this.building = null;
      return;
    }
    this.startBuild(); // reconstrói em segundo plano; troca quando o 1º loop novo estiver pronto
  }

  /** Resolve quando o 1º loop (calmo+animado) está pronto, ou todos (`all`). Resolve já se não há pré-render. */
  whenReady(all = false): Promise<void> {
    return new Promise<void>((res) => {
      if (this.isReady(all)) return res();
      this.readyWaiters.push({ all, res });
    });
  }
  private isReady(all: boolean): boolean {
    if (!this.usePre) return true;
    const l = this.building ?? this.lib;
    if (!l) return false;
    if (all) return l.done;
    const v = l.variants[0];
    return !!(v && v.calm && v.lively);
  }
  private flushReady(): void {
    const w = this.readyWaiters;
    this.readyWaiters = w.filter((x) => !(this.isReady(x.all) && (x.res(), true)));
  }

  private ri(n: number): number {
    return Math.floor(this.rnd() * n);
  }
  private defer(fn: () => void, ms: number): unknown {
    return (this.o.defer ?? ((f, m) => setTimeout(f, m)))(fn, ms);
  }
  private sleep(ms: number): Promise<void> {
    return new Promise((r) => this.defer(r, ms));
  }
  private cpuNow(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
  private targetSr(): number {
    return this.eco ? ECONOMY_SR : this.engine.ctx?.sampleRate || 44100;
  }

  start(mode: MusicMode = this.mode): void {
    const ctx = this.engine.ctx;
    if (this.running || !ctx || this.disposed) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.bed = ctx.createGain();
    this.out.connect(this.bed);
    this.bed.connect(this.engine.musicBus);
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.rampedIn = false;
    this.running = true;
    this.paused = false;
    this.mode = mode;
    this.chain = null;
    this.unsub = this.engine.onVisibility((hidden) => (hidden ? this.pause() : this.resume()));
    if (this.usePre) {
      if (!this.lib || this.lib.sr !== this.targetSr()) {
        this.lib = null;
        this.startBuild();
      } else if (!this.lib.done) this.startBuild(this.lib);
      this.tryPlay();
    } else this.liveBegin();
  }

  /** Para com fade e limpa todos os nós. */
  stop(fade = 0.6): void {
    if (!this.running || !this.ctx) return;
    this.running = false;
    this.tok++; // cancela a renderização em andamento (o que já ficou pronto é mantido)
    this.building = null;
    this.wakeWaiters();
    clearTimeout(this.timer);
    clearTimeout(this.livelyOff);
    this.unsub?.();
    this.unsub = null;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    const chains = [...(this.chain ? [this.chain] : []), ...this.retiring];
    const voices = this.voices;
    const nodes = [this.calmBus, this.livelyBus, this.out, this.bed];
    this.chain = null;
    this.retiring.clear();
    for (const h of this.retireTimers) clearTimeout(h);
    this.retireTimers.clear();
    this.stopT = setTimeout(() => {
      for (const c of chains) this.kill(c);
      voices?.stopAll();
      for (const n of nodes) {
        try {
          n?.disconnect();
        } catch {
          /* ok */
        }
      }
    }, fade * 1000 + 80);
    this.ctx = null;
    this.voices = null;
    this.calmBus = this.livelyBus = null;
    this.lb = null;
    this.liveSec = null;
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.chain && this.ctx) {
      // guarda a posição e derruba os nós: pausa não custa nada
      this.savedFrac = this.posOf(this.chain);
      this.savedVi = this.chain.cur.vi;
      this.teardownAll();
    }
  }

  resume(): void {
    if (!this.running || !this.paused || !this.ctx) return;
    this.paused = false;
    this.wakeWaiters();
    if (this.usePre) this.tryPlay(0.25);
    else {
      this.nextT = Math.max(this.nextT, this.ctx.currentTime + 0.05);
      this.liveTick();
    }
  }

  /** Crossfade calmo ↔ animado. */
  setMode(m: MusicMode): void {
    this.mode = m;
    if (m === 'calm') this.wakeWaiters(); // retoma a pré-renderização parada durante o sorteio
    if (!this.running || !this.ctx) return;
    if (this.usePre) {
      this.syncMode();
      return;
    }
    clearTimeout(this.livelyOff);
    const t = this.ctx.currentTime;
    if (m === 'lively') {
      this.livelyOn = true;
      this.livelyBus?.gain.setTargetAtTime(1, t, 0.6);
    } else {
      this.livelyBus?.gain.setTargetAtTime(0, t, 0.6);
      this.livelyOff = setTimeout(() => (this.livelyOn = false), 3200);
    }
  }

  dispose(): void {
    this.stop(0.05);
    this.disposed = true;
    this.tok++;
    this.lib = null;
    this.building = null;
    this.readyWaiters.forEach((w) => w.res());
    this.readyWaiters = [];
    this.wakeWaiters();
  }

  // =====================================================================
  //  PRÉ-RENDERIZAÇÃO (OfflineAudioContext, em fatias, em tempo ocioso)
  // =====================================================================
  private startBuild(reuse?: Lib): void {
    const n = this.o.variants ?? (this.eco ? 2 : 3);
    const lib: Lib = reuse ?? { sr: this.targetSr(), n, variants: [], stingers: new Map(), done: false };
    this.building = lib;
    const tok = ++this.tok;
    void this.build(lib, tok);
  }

  private blocked(): boolean {
    // Durante o sorteio ('lively') a pré-renderização espera (cada fatia custa CPU na thread principal e disputa
    // quadros com a animação); só a 1ª variação, de que a música precisa, não espera. Volta no `setMode('calm')`.
    return this.paused || (this.mode === 'lively' && this.firstVariantReady());
  }
  private firstVariantReady(): boolean {
    const l = this.building ?? this.lib;
    const v = l?.variants[0];
    return !!(v && v.calm && v.lively && l!.stingers.size >= 2);
  }
  private wakeWaiters(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }
  /** Espera enquanto pausado (aba oculta/mudo); false se a tarefa foi cancelada. */
  private async gate(tok: number): Promise<boolean> {
    while (tok === this.tok && !this.disposed && this.blocked()) await new Promise<void>((r) => this.waiters.push(r));
    return tok === this.tok && !this.disposed;
  }

  private async build(lib: Lib, tok: number): Promise<void> {
    try {
      await this.sleep(START_DELAY_MS);
      for (let i = 0; i < lib.n; i++) {
        if (!lib.variants[i]) {
          const avoid = lib.variants.map((v) => v.sec.progIdx);
          const prevKey = lib.variants.length ? lib.variants[lib.variants.length - 1].sec.key : -1;
          lib.variants.push({ sec: makeSection(this.rnd, avoid, prevKey), calm: null, lively: null });
        }
        const variant = lib.variants[i];
        for (const mode of ['calm', 'lively'] as const) {
          if (variant[mode]) continue;
          const buf = await this.renderLoop(lib, tok, variant.sec, mode);
          if (!buf) return;
          variant[mode] = buf;
          this.onBuffer(lib);
          await this.sleep(i === 0 ? TASK_GAP_MS : LATER_GAP_MS);
          if (tok !== this.tok) return;
        }
        for (const kind of ['win', 'bingo'] as const) {
          const k = `${variant.sec.key}:${kind}`;
          if (lib.stingers.has(k)) continue;
          const st = await this.renderSting(lib, tok, variant.sec.key, kind);
          if (!st) return;
          lib.stingers.set(k, st);
          await this.sleep(i === 0 ? TASK_GAP_MS : LATER_GAP_MS);
          if (tok !== this.tok) return;
        }
      }
      lib.done = true;
      this.flushReady();
    } catch {
      // renderização indisponível/falhou: se nada toca ainda, cai no procedural
      if (tok === this.tok && !(this.lib && this.lib.variants[0]?.calm)) this.fallbackToLive();
      else this.flushReady();
    }
  }

  private onBuffer(lib: Lib): void {
    if (this.building === lib && lib.variants[0]?.calm && this.lib !== lib) this.lib = lib;
    this.flushReady();
    if (this.lib === lib) {
      if (!this.chain) this.tryPlay();
      else this.syncMode();
    }
  }

  private async renderLoop(lib: Lib, tok: number, sec: Section, mode: MusicMode): Promise<AudioBuffer | null> {
    const dur = (STEPS * BARS * 60) / BPM[mode] / 4;
    const len = Math.round(dur * lib.sr);
    const tail = Math.round(LOOP_TAIL_S * lib.sr);
    const off = newOffline(1, len + tail, lib.sr);
    const v = new Voices(off, true);
    const out = off.createGain();
    out.gain.value = 1.4;
    out.connect(off.destination);
    const calm = off.createGain();
    const lively = off.createGain();
    calm.connect(out);
    lively.connect(out);
    const b = new SectionBuilder({
      v,
      calm,
      lively,
      sec,
      rnd: this.rnd,
      mode: () => mode,
      livelyOn: () => mode === 'lively',
      t0: 0,
    });
    while (!b.done) {
      if (!(await this.gate(tok))) return null;
      const t0 = this.cpuNow();
      do b.scheduleStep();
      while (!b.done && this.cpuNow() - t0 < SLICE_MS);
      await this.sleep(SLICE_GAP_MS);
    }
    if (!(await this.gate(tok))) return null;
    const rendered = await renderCompat(off);
    if (tok !== this.tok) return null;
    return await this.fold(off, rendered, len, tail, lib.sr);
  }

  /** Dobra a cauda sobre o início: o fim "toca por cima" do começo e o loop não tem emenda audível. */
  private async fold(off: OfflineAudioContext, r: AudioBuffer, len: number, tail: number, sr: number): Promise<AudioBuffer> {
    if (r.length <= len) return r;
    const src = r.getChannelData(0);
    let out: AudioBuffer;
    try {
      out = off.createBuffer(1, len, sr);
    } catch {
      return r;
    }
    const d = out.getChannelData(0);
    d.set(src.subarray(0, len));
    const n = Math.min(tail, r.length - len, len);
    // em blocos (a soma da cauda numa tacada só custava dezenas de ms num tablet fraco)
    for (let i = 0; i < n; ) {
      const end = Math.min(n, i + 16384);
      for (; i < end; i++) d[i] += src[len + i];
      if (i < n) await this.sleep(0);
    }
    return out;
  }

  private async renderSting(lib: Lib, tok: number, key: number, kind: StingerKind): Promise<Sting | null> {
    if (!(await this.gate(tok))) return null;
    const big = kind === 'bingo';
    const total = stingTotal(big);
    const off = newOffline(1, Math.ceil((total + 0.35) * lib.sr), lib.sr);
    const v = new Voices(off, true);
    const sb = off.createGain();
    sb.gain.value = big ? 2.1 : 1.8;
    sb.connect(off.destination);
    const tasks = stingerTasks(v, sb, 0.02, key, big);
    for (let i = 0; i < tasks.length; ) {
      if (!(await this.gate(tok))) return null;
      const t0 = this.cpuNow();
      do tasks[i++]();
      while (i < tasks.length && this.cpuNow() - t0 < SLICE_MS);
      await this.sleep(SLICE_GAP_MS);
    }
    if (!(await this.gate(tok))) return null;
    const buf = await renderCompat(off);
    if (tok !== this.tok) return null;
    return { buf, total };
  }

  private fallbackToLive(): void {
    if (!this.usePre) return;
    this.usePre = false;
    this.lib = null;
    this.building = null;
    this.flushReady();
    if (this.running && !this.paused && this.ctx) this.liveBegin();
  }

  // ---------- reprodução dos buffers ----------
  private pickStart(): { mode: MusicMode; vi: number; buf: AudioBuffer } | null {
    const lib = this.lib;
    if (!lib) return null;
    for (const mode of [this.mode, this.mode === 'calm' ? 'lively' : 'calm'] as const) {
      const order = [this.savedVi, ...lib.variants.keys()];
      for (const vi of order) {
        const buf = lib.variants[vi]?.[mode];
        if (buf) return { mode, vi, buf };
      }
    }
    return null;
  }

  private tryPlay(fade = 0): void {
    const ctx = this.ctx;
    if (!this.running || this.paused || !ctx || !this.usePre || this.chain) return;
    const p = this.pickStart();
    if (!p) return;
    const t = ctx.currentTime;
    if (!this.rampedIn) {
      this.rampedIn = true;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(0.0001, t);
      this.out.gain.linearRampToValueAtTime(1, t + 1.5);
    } else this.out.gain.setTargetAtTime(1, t, 0.05);
    this.chain = this.startChain(p.mode, p.vi, p.buf, this.savedFrac, fade > 0 ? 'lin' : 'none', fade);
    this.syncMode();
  }

  private startChain(
    mode: MusicMode,
    vi: number,
    buf: AudioBuffer,
    frac: number,
    fade: 'none' | 'lin' | 'xf',
    fadeS: number,
  ): Chain {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.out);
    const t = ctx.currentTime;
    if (fade === 'lin') {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + fadeS);
    } else if (fade === 'xf') {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setTargetAtTime(1, t, XFADE_TAU);
    } else g.gain.value = 1;
    const c: Chain = { mode, g, cur: null as unknown as Seg, nxt: null, timer: undefined, dead: false };
    const key = this.lib?.variants[vi]?.sec.key ?? 0;
    c.cur = this.mkSeg(c, buf, vi, key, t + 0.05, Math.min(0.999, Math.max(0, frac)) * buf.duration);
    this.arm(c);
    return c;
  }

  private mkSeg(c: Chain, buf: AudioBuffer, vi: number, key: number, when: number, offset: number): Seg {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(c.g);
    src.start(when, offset);
    return { src, start: when - offset, end: when + buf.duration - offset, dur: buf.duration, vi, key };
  }

  private arm(c: Chain): void {
    const ctx = this.ctx;
    if (c.dead || !ctx) return;
    clearTimeout(c.timer);
    const wait = (c.cur.end - ctx.currentTime - NEXT_LEAD_S) * 1000;
    c.timer = setTimeout(() => this.advance(c), Math.max(50, wait));
  }

  /** Agenda, com folga, o próximo loop (sample-accurate: começa exatamente quando o atual termina). */
  private advance(c: Chain): void {
    c.timer = undefined;
    const ctx = this.ctx;
    if (c.dead || !ctx || c.nxt) return;
    if (c.cur.end - ctx.currentTime > NEXT_LEAD_S + 0.25) return this.arm(c); // relógio parado (suspenso)
    const lib = this.lib;
    const cands: number[] = [];
    lib?.variants.forEach((v, i) => v[c.mode] && i !== c.cur.vi && cands.push(i));
    let vi = c.cur.vi;
    let buf = c.cur.src.buffer as AudioBuffer;
    if (lib && cands.length) {
      vi = cands[this.ri(cands.length)];
      buf = lib.variants[vi][c.mode]!;
    }
    const key = lib?.variants[vi]?.sec.key ?? c.cur.key;
    const old = c.cur;
    const nxt = this.mkSeg(c, buf, vi, key, old.end, 0);
    c.nxt = nxt;
    old.src.onended = () => {
      try {
        old.src.disconnect();
      } catch {
        /* ok */
      }
      if (c.dead || !c.nxt) return;
      c.cur = c.nxt;
      c.nxt = null;
      this.arm(c);
    };
  }

  private posOf(c: Chain): number {
    const t = this.ctx!.currentTime;
    const s = c.nxt && t >= c.cur.end ? c.nxt : c.cur;
    const f = (t - s.start) / s.dur;
    return f <= 0 ? 0 : f - Math.floor(f);
  }

  /** Garante que o loop tocando é o do modo pedido; troca com crossfade assim que o buffer existe. */
  private syncMode(): void {
    const c = this.chain;
    const ctx = this.ctx;
    const lib = this.lib;
    if (!c || !ctx || !lib || this.paused || c.mode === this.mode) return;
    const mode = this.mode;
    const pref = c.cur.vi;
    let vi = lib.variants[pref]?.[mode] ? pref : lib.variants.findIndex((v) => v[mode]);
    if (vi < 0) return; // ainda renderizando: troca quando ficar pronto
    const buf = lib.variants[vi][mode]!;
    const frac = this.posOf(c); // mesma posição musical (compasso e tempo), outro andamento
    const t = ctx.currentTime;
    c.g.gain.cancelScheduledValues(t);
    c.g.gain.setValueAtTime(c.g.gain.value, t);
    c.g.gain.setTargetAtTime(0, t, XFADE_TAU);
    this.chain = this.startChain(mode, vi, buf, frac, 'xf', 0);
    this.retiring.add(c);
    const h = setTimeout(() => {
      this.retireTimers.delete(h);
      this.retiring.delete(c);
      this.kill(c);
    }, 3300);
    this.retireTimers.add(h);
  }

  private kill(c: Chain): void {
    c.dead = true;
    clearTimeout(c.timer);
    for (const s of [c.cur, c.nxt]) {
      if (!s) continue;
      s.src.onended = null;
      try {
        s.src.stop();
      } catch {
        /* ok */
      }
      try {
        s.src.disconnect();
      } catch {
        /* ok */
      }
    }
    try {
      c.g.disconnect();
    } catch {
      /* ok */
    }
  }

  private teardownAll(): void {
    if (this.chain) this.kill(this.chain);
    for (const c of this.retiring) this.kill(c);
    for (const h of this.retireTimers) clearTimeout(h);
    this.retireTimers.clear();
    this.retiring.clear();
    this.chain = null;
  }

  // =====================================================================
  //  STINGER
  // =====================================================================
  /**
   * Trecho curto (3–6 s) na tonalidade atual; a trilha abaixa e volta com fade.
   * Retorna false se a música não está tocando ou o stinger ainda não foi renderizado
   * (use o efeito sonoro equivalente).
   */
  stinger(kind: StingerKind): boolean {
    const ctx = this.ctx;
    if (!this.running || !ctx || this.paused) return false;
    const big = kind === 'bingo';
    const d = this.bed;
    const duck = (total: number) => {
      const t0 = ctx.currentTime + 0.06;
      d.gain.cancelScheduledValues(t0);
      d.gain.setValueAtTime(d.gain.value, t0);
      d.gain.linearRampToValueAtTime(0.18, t0 + 0.15);
      const back = t0 + total;
      d.gain.setValueAtTime(0.18, back - 0.01);
      d.gain.linearRampToValueAtTime(1, back + 1.2);
      return t0;
    };

    if (this.usePre) {
      const c = this.chain;
      const st = c && this.lib?.stingers.get(`${c.cur.key}:${kind}`);
      if (!st) return false;
      const t0 = duck(st.total);
      const src = ctx.createBufferSource();
      src.buffer = st.buf;
      src.connect(this.engine.musicBus);
      src.onended = () => {
        try {
          src.disconnect();
        } catch {
          /* ok */
        }
      };
      src.start(t0);
      return true;
    }

    // fallback procedural (v2)
    const v = this.voices;
    if (!v || !this.liveSec) return false;
    const t0 = duck(stingTotal(big));
    const sb = ctx.createGain();
    sb.gain.value = big ? 2.1 : 1.8;
    sb.connect(this.engine.musicBus);
    setTimeout(
      () => {
        try {
          sb.disconnect();
        } catch {
          /* ok */
        }
      },
      (stingTotal(big) + 0.5) * 1000,
    );
    buildStinger(v, sb, t0, this.liveSec.key, big);
    return true;
  }

  // =====================================================================
  //  MODO PROCEDURAL AO VIVO (fallback / v2): agendamento com lookahead
  // =====================================================================
  private liveBegin(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.voices = new Voices(ctx);
    this.calmBus = ctx.createGain();
    this.livelyBus = ctx.createGain();
    this.calmBus.connect(this.out);
    this.livelyBus.connect(this.out);
    const t = ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(1.4, t + 1.5);
    this.rampedIn = true;
    this.calmBus.gain.value = 1;
    this.livelyOn = this.mode === 'lively';
    this.livelyBus.gain.value = this.livelyOn ? 1 : 0;
    this.nextT = t + 0.12;
    this.lb = null;
    this.liveSec = null;
    this.liveTick();
  }

  private liveTick = (): void => {
    this.timer = undefined;
    const ctx = this.ctx;
    if (!this.running || this.paused || !ctx || this.usePre || !this.voices) return;
    const now = ctx.currentTime;
    if (this.nextT < now - 0.3) this.nextT = now + 0.05; // timers atrasados: ressincroniza
    while (this.nextT < now + LOOKAHEAD) this.liveStep();
    this.timer = setTimeout(this.liveTick, TICK_MS);
  };

  private liveStep(): void {
    if (!this.lb || this.lb.done) {
      const prev = this.liveSec;
      this.liveSec = makeSection(this.rnd, prev ? [prev.progIdx] : [], prev ? prev.key : -1);
      this.lb = new SectionBuilder({
        v: this.voices!,
        calm: this.calmBus!,
        lively: this.livelyBus!,
        sec: this.liveSec,
        rnd: this.rnd,
        mode: () => this.mode,
        livelyOn: () => this.livelyOn,
        t0: this.lb ? this.lb.nextT : this.nextT,
        melIdx: this.lb?.melIdx,
      });
    }
    this.lb.scheduleStep();
    this.nextT = this.lb.nextT;
  }
}
