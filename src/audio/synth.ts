// Utilitários mínimos de síntese compartilhados por música e efeitos.
// Regra: todo nó criado aqui se desconecta sozinho ao terminar (sem vazamento).

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

let noiseBuf: AudioBuffer | null = null;
let noiseCtx: BaseAudioContext | null = null;

/** 1 s de ruído branco reaproveitado por todas as percussões. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseCtx === ctx) return noiseBuf;
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 0x80000000 - 1) * 0.9;
  }
  noiseBuf = b;
  noiseCtx = ctx;
  return b;
}

/** Registro de fontes ativas para poder calar tudo de uma vez. */
export class Voices {
  private active = new Set<AudioScheduledSourceNode>();
  constructor(readonly ctx: BaseAudioContext) {}

  /** Agenda fonte [t, t+dur]; ao terminar desconecta `chain`. */
  run(src: AudioScheduledSourceNode, t: number, dur: number, chain: AudioNode[]): void {
    this.active.add(src);
    src.onended = () => {
      this.active.delete(src);
      try {
        src.disconnect();
      } catch {
        /* já desconectado */
      }
      for (const n of chain) {
        try {
          n.disconnect();
        } catch {
          /* idem */
        }
      }
    };
    src.start(t);
    src.stop(t + dur);
  }

  /** Para tudo imediatamente (limpa nós). */
  stopAll(): void {
    for (const s of [...this.active]) {
      try {
        s.stop();
      } catch {
        /* ainda não iniciada */
      }
    }
  }

  get count(): number {
    return this.active.size;
  }
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  t: number;
  dur: number; // duração audível (decaimento)
  gain: number;
  attack?: number;
  cutoff?: [number, number]; // lowpass inicial → final (Hz)
  glideTo?: number; // freq final
  detune?: number;
}

/** Tom simples: osc → (lowpass) → gain exp. → destino. */
export function tone(v: Voices, dest: AudioNode, o: ToneOpts): void {
  const ctx = v.ctx;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, o.t);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, o.t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  const chain: AudioNode[] = [g];
  if (o.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.cutoff[0], o.t);
    f.frequency.exponentialRampToValueAtTime(o.cutoff[1], o.t + o.dur);
    osc.connect(f);
    f.connect(g);
    chain.push(f);
  } else osc.connect(g);
  g.connect(dest);
  v.run(osc, o.t, o.dur + 0.02, chain);
}

export interface NoiseOpts {
  t: number;
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
  q?: number;
  attack?: number;
}

/** Rajada de ruído filtrada (shaker, rim, pandeiro, crash). */
export function noiseHit(v: Voices, dest: AudioNode, o: NoiseOpts): void {
  const ctx = v.ctx;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 0.7;
  const g = ctx.createGain();
  const a = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.loopStart = 0;
  v.run(src, o.t, o.dur + 0.02, [f, g]);
}
