// Música PROCEDURAL original: groove brasileiro leve (bossa/samba-jazz suave), 102–112 BPM.
// Violão e cavaquinho sintetizados, piano elétrico (FM), baixo, marimba e percussão leve.
// Agendamento com lookahead (setTimeout encadeado). Nada de setInterval; nós se desconectam sozinhos.
import type { AudioEngine } from './engine';
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

export interface MusicOptions {
  rnd?: () => number;
}

export class Music {
  private ctx: AudioContext | null = null;
  private voices: Voices | null = null;
  private out!: GainNode; // fade geral
  private bed!: GainNode; // abaixa durante stinger
  private calmBus!: GainNode;
  private livelyBus!: GainNode;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private livelyOff: ReturnType<typeof setTimeout> | undefined;
  private stopT: ReturnType<typeof setTimeout> | undefined;
  private unsub: (() => void) | null = null;
  private running = false;
  private paused = false;
  private livelyOn = false;
  private mode: MusicMode = 'calm';
  private rnd: () => number;

  // estado do sequenciador
  private nextT = 0;
  private step = 0;
  private bar = 0;
  private key = 0;
  private progIdx = -1;
  private prog: Chord[][] = [];
  private bpm: number = BPM.calm;
  private bassPat: Pat = BASS_CALM[0];
  private bassPatL: Pat = BASS_LIVELY[0];
  private gtrCalm = GTR_CALM[0];
  private gtrLively = GTR_LIVELY[0];
  private melCell: number[] = [];
  private melIdx = 0;
  private epStyle = 0;

  constructor(private engine: AudioEngine, o: MusicOptions = {}) {
    this.rnd = o.rnd ?? Math.random;
  }

  get isRunning(): boolean {
    return this.running;
  }
  get currentMode(): MusicMode {
    return this.mode;
  }

  private ri(n: number): number {
    return Math.floor(this.rnd() * n);
  }

  start(mode: MusicMode = this.mode): void {
    const ctx = this.engine.ctx;
    if (this.running || !ctx) return;
    clearTimeout(this.stopT);
    this.ctx = ctx;
    this.voices = new Voices(ctx);
    this.out = ctx.createGain();
    this.bed = ctx.createGain();
    this.calmBus = ctx.createGain();
    this.livelyBus = ctx.createGain();
    this.calmBus.connect(this.out);
    this.livelyBus.connect(this.out);
    this.out.connect(this.bed);
    this.bed.connect(this.engine.musicBus);
    const t = ctx.currentTime;
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(1.4, t + 1.5);
    this.calmBus.gain.value = 1;
    this.livelyBus.gain.value = 0;
    this.running = true;
    this.paused = false;
    this.mode = mode;
    this.livelyOn = mode === 'lively';
    this.livelyBus.gain.value = this.livelyOn ? 1 : 0;
    this.bpm = BPM[mode];
    this.step = 0;
    this.bar = 0;
    this.progIdx = -1;
    this.key = KEYS[this.ri(KEYS.length)];
    this.nextT = t + 0.12;
    this.unsub = this.engine.onVisibility((hidden) => (hidden ? this.pause() : this.resume()));
    this.tick();
  }

  /** Para com fade e limpa todos os nós. */
  stop(fade = 0.6): void {
    if (!this.running || !this.ctx) return;
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.livelyOff);
    this.unsub?.();
    this.unsub = null;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    const voices = this.voices!;
    const nodes = [this.calmBus, this.livelyBus, this.out, this.bed];
    this.stopT = setTimeout(() => {
      voices.stopAll();
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ok */
        }
      }
    }, fade * 1000 + 80);
    this.ctx = null;
    this.voices = null;
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    clearTimeout(this.timer);
  }
  resume(): void {
    if (!this.running || !this.paused || !this.ctx) return;
    this.paused = false;
    this.nextT = Math.max(this.nextT, this.ctx.currentTime + 0.05);
    this.tick();
  }

  /** Crossfade calmo ↔ animado (camadas extras entram/saem; andamento muda no próximo compasso). */
  setMode(m: MusicMode): void {
    this.mode = m;
    if (!this.running || !this.ctx) return;
    clearTimeout(this.livelyOff);
    const t = this.ctx.currentTime;
    if (m === 'lively') {
      this.livelyOn = true;
      this.livelyBus.gain.setTargetAtTime(1, t, 0.6);
    } else {
      this.livelyBus.gain.setTargetAtTime(0, t, 0.6);
      this.livelyOff = setTimeout(() => (this.livelyOn = false), 3200);
    }
  }

  // ---------- agendador ----------
  private tick = (): void => {
    this.timer = undefined;
    if (!this.running || this.paused || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.nextT < now - 0.3) this.nextT = now + 0.05; // timers atrasados: ressincroniza
    while (this.nextT < now + LOOKAHEAD) this.scheduleStep();
    this.timer = setTimeout(this.tick, TICK_MS);
  };

  private newSection(): void {
    let p = this.ri(PROGS.length);
    if (p === this.progIdx) p = (p + 1 + this.ri(PROGS.length - 1)) % PROGS.length;
    this.progIdx = p;
    if (this.rnd() < 0.4) {
      let k = KEYS[this.ri(KEYS.length)];
      if (k === this.key) k = KEYS[(KEYS.indexOf(k) + 1) % KEYS.length];
      this.key = k;
    }
    this.prog = PROGS[p].map((bar) =>
      bar.split(' ').map((tk) => {
        const [off, q] = TOK[tk];
        return { pc: (this.key + off) % 12, iv: QUAL[q] };
      }),
    );
    this.bassPat = BASS_CALM[this.ri(BASS_CALM.length)];
    this.bassPatL = BASS_LIVELY[this.ri(BASS_LIVELY.length)];
    this.gtrCalm = GTR_CALM[this.ri(GTR_CALM.length)];
    this.gtrLively = GTR_LIVELY[this.ri(GTR_LIVELY.length)];
    this.epStyle = this.ri(2);
  }

  private chordAt(bar: number, step: number): Chord {
    const cs = this.prog[bar];
    return cs.length === 1 ? cs[0] : cs[step < 8 ? 0 : 1];
  }

  private scheduleStep(): void {
    const v = this.voices!;
    const s = this.step;
    if (s === 0) {
      if (this.bar === 0) this.newSection();
      this.bpm = BPM[this.mode];
      this.melCell = this.rnd() < (this.mode === 'lively' ? 0.7 : 0.3) ? CELLS[this.ri(CELLS.length)] : [];
    }
    const sd = 60 / this.bpm / 4;
    const t = this.nextT + (s % 2 === 1 ? SWING * sd : 0);
    const ch = this.chordAt(this.bar, s);
    const lively = this.livelyOn;
    const bus = this.calmBus;
    const lbus = this.livelyBus;

    // baixo
    const bp = lively ? this.bassPatL : this.bassPat;
    const bk = bp[s];
    if (bk) {
      const root = 28 + ((ch.pc - 28 + 120) % 12);
      const m = bk === 'r' ? root : bk === 'f' ? root + 7 : bk === 'o' ? root + 12 : root + ch.iv[1];
      this.bass(v, bus, t, m > 47 ? m - 12 : m, bk === 'r' ? 0.55 : 0.42, sd * (bk === 'r' ? 5 : 3));
    }

    // violão
    const gp = lively ? this.gtrLively : this.gtrCalm;
    if (gp.includes(s)) {
      const notes = stack(ch.pc, ch.iv, [0, 2, 3, 1], 45);
      notes.forEach((m, i) => this.pluck(v, bus, t + i * 0.011, m, s === gp[0] ? 0.17 : 0.12, 0.45));
    }

    // piano elétrico
    if (s === 0 || (s === 8 && this.epStyle === 1) || (s === 10 && this.rnd() < 0.5)) {
      const notes = stack(ch.pc, ch.iv, ch.iv.length > 4 ? [1, 3, 4] : [1, 3, 2], 50);
      const dur = s === 0 ? sd * 10 : sd * 3;
      notes.forEach((m, i) => this.epiano(v, bus, t + i * 0.008, m, (s === 0 ? 0.11 : 0.08) / (1 + i * 0.2), dur));
    }

    // marimba (melodia leve)
    const ci = this.melCell.indexOf(s);
    if (ci >= 0) {
      const allowed = new Set([...ch.iv.map((x) => (ch.pc + x) % 12), (ch.pc + 2) % 12]);
      const cand: number[] = [];
      for (let m = 67; m <= 86; m++) if (allowed.has(m % 12)) cand.push(m);
      this.melIdx = Math.max(0, Math.min(cand.length - 1, (this.melIdx || cand.length >> 1) + this.ri(5) - 2));
      this.marimba(v, lively ? lbus : bus, t, cand[Math.min(this.melIdx, cand.length - 1)], lively ? 0.1 : 0.07);
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
        notes.forEach((m, i) => this.cavaco(v, lbus, t + i * 0.006, m, s % 4 === 0 ? 0.075 : 0.045));
      }
    }

    // avança
    this.nextT += sd;
    if (++this.step >= STEPS) {
      this.step = 0;
      if (++this.bar >= BARS) this.bar = 0;
    }
  }

  // ---------- instrumentos ----------
  private bass(v: Voices, d: AudioNode, t: number, m: number, g: number, dur: number): void {
    const f = midiHz(m);
    tone(v, d, { type: 'triangle', freq: f, t, dur, gain: g, attack: 0.008, cutoff: [900, 260] });
    tone(v, d, { type: 'sine', freq: f, t, dur: dur * 0.8, gain: g * 0.5, attack: 0.008 });
  }
  private pluck(v: Voices, d: AudioNode, t: number, m: number, g: number, dur: number): void {
    tone(v, d, { type: 'sawtooth', freq: midiHz(m), t, dur, gain: g, attack: 0.002, cutoff: [3400, 520] });
  }
  private cavaco(v: Voices, d: AudioNode, t: number, m: number, g: number): void {
    tone(v, d, { type: 'sawtooth', freq: midiHz(m), t, dur: 0.13, gain: g, attack: 0.002, cutoff: [6500, 1800] });
  }
  private marimba(v: Voices, d: AudioNode, t: number, m: number, g: number): void {
    const f = midiHz(m);
    tone(v, d, { freq: f, t, dur: 0.55, gain: g });
    tone(v, d, { freq: f * 4, t, dur: 0.12, gain: g * 0.3 });
  }
  /** Piano elétrico FM (tine): portadora + modulador 1:1 com índice decaindo. */
  private epiano(v: Voices, d: AudioNode, t: number, m: number, g: number, dur: number): void {
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

  // ---------- stinger de vitória ----------
  /**
   * Trecho curto (3–6 s) na tonalidade atual; a trilha abaixa e volta com fade.
   * Retorna false se a música não está tocando (use o efeito sonoro equivalente).
   */
  stinger(kind: StingerKind): boolean {
    const ctx = this.ctx;
    const v = this.voices;
    if (!this.running || !ctx || !v || this.paused) return false;
    const big = kind === 'bingo';
    const t0 = ctx.currentTime + 0.06;
    const sd = 60 / 116 / 4;
    const tonic = 60 + (this.key > 6 ? this.key - 12 : this.key);
    const d = this.bed;
    const total = (big ? 22 : 14) * sd + 1.8;

    d.gain.cancelScheduledValues(t0);
    d.gain.setValueAtTime(d.gain.value, t0);
    d.gain.linearRampToValueAtTime(0.18, t0 + 0.15);
    const back = t0 + total;
    d.gain.setValueAtTime(0.18, back - 0.01);
    d.gain.linearRampToValueAtTime(1, back + 1.2);

    // o stinger usa um bus próprio direto em musicBus (a trilha abaixa via `bed`)
    const sb = ctx.createGain();
    sb.gain.value = big ? 2.1 : 1.8;
    sb.connect(this.engine.musicBus);
    setTimeout(() => {
      try {
        sb.disconnect();
      } catch {
        /* ok */
      }
    }, (total + 0.5) * 1000);

    const T = (i: number) => t0 + i * sd;
    const mel = big
      ? [[0, 6], [4, 7], [7, 8], [12, 9], [9, 11], [14, 12], [16, 13], [12, 14], [19, 15], [16, 16], [24, 18]]
      : [[0, 0], [4, 1], [7, 2], [12, 3], [9, 5], [16, 6], [14, 8]];
    // chamada em 3 batidas + fim sustentado (bingo)
    if (big) {
      [0, 2, 4].forEach((i) => this.brass(v, sb, T(i), tonic, sd * 1.6));
      this.brass(v, sb, T(6), tonic, sd * 5, true);
      tone(v, sb, { freq: 100, glideTo: 50, t: T(0), dur: 0.3, gain: 0.5 });
      noiseHit(v, sb, { t: T(6), dur: 0.9, gain: 0.07, filter: 'highpass', freq: 5000, attack: 0.03 });
    }
    for (const [off, i] of mel) {
      const m = tonic + 12 + off;
      this.marimba(v, sb, T(i), m, 0.16);
      if (i % 2 === 0) this.epiano(v, sb, T(i), m - 12, 0.1, sd * 2);
    }
    // samba: surdo, shaker e pandeiro
    const len = big ? 22 : 14;
    for (let i = 0; i < len; i++) {
      const t = T(i);
      noiseHit(v, sb, { t, dur: 0.05, gain: 0.05, filter: 'highpass', freq: 7000 });
      if (i % 8 === 0 || (i > 8 && i % 8 === 4)) tone(v, sb, { freq: 95, glideTo: 58, t, dur: 0.28, gain: 0.45 });
      if (i % 4 === 2) noiseHit(v, sb, { t, dur: 0.07, gain: 0.08, filter: 'bandpass', freq: 3200, q: 1.5 });
    }
    // acorde final (Imaj9) em violão + piano + marimba
    const endI = big ? 18 : 10;
    const chord = [0, 4, 7, 11, 14];
    chord.forEach((o, i) => {
      this.pluck(v, sb, T(endI) + i * 0.012, tonic - 12 + o, 0.2, 1.6);
      this.epiano(v, sb, T(endI) + i * 0.01, tonic + o, 0.1, 1.6);
    });
    this.marimba(v, sb, T(endI), tonic + 24, 0.14);
    this.bass(v, sb, T(endI), 28 + ((tonic - 28 + 120) % 12), 0.6, 1.4);
    return true;
  }

  private brass(v: Voices, d: AudioNode, t: number, tonic: number, dur: number, long = false): void {
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

  dispose(): void {
    this.stop(0.05);
  }
}
