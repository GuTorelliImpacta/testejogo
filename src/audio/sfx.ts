// Efeitos sonoros sintetizados (zero download). Todos curtos, originais e suaves.
import type { AudioEngine } from './engine';
import { Voices, midiHz, noiseHit, tone } from './synth';

export class Sfx {
  private voices: Voices | null = null;
  private lastCtx: BaseAudioContext | null = null;

  constructor(private engine: AudioEngine) {}

  /** Retorna [voices, destino, t0] ou null se o áudio ainda não foi liberado. */
  private env(): { v: Voices; d: AudioNode; t: number } | null {
    const ctx = this.engine.ctx;
    if (!ctx || ctx.state !== 'running' || !this.engine.audible) return null;
    if (ctx !== this.lastCtx || !this.voices) {
      this.voices = new Voices(ctx);
      this.lastCtx = ctx;
    }
    return { v: this.voices, d: this.engine.sfxBus, t: ctx.currentTime + 0.01 };
  }

  private bell(v: Voices, d: AudioNode, t: number, midi: number, g: number, dur = 0.5): void {
    const f = midiHz(midi);
    tone(v, d, { freq: f, t, dur, gain: g });
    tone(v, d, { freq: f * 2.76, t, dur: dur * 0.3, gain: g * 0.25 });
  }

  /** Bola girando e saindo: chocalho de madeira que acelera e um "toc" final. */
  ballDraw(): void {
    const e = this.env();
    if (!e) return;
    let t = e.t;
    let gap = 0.075;
    for (let i = 0; i < 6; i++) {
      noiseHit(e.v, e.d, { t, dur: 0.03, gain: 0.16, filter: 'bandpass', freq: 1500 + i * 220, q: 3 });
      t += gap;
      gap *= 0.84;
    }
    tone(e.v, e.d, { freq: 520, glideTo: 780, t, dur: 0.14, gain: 0.22, type: 'triangle' });
  }

  /** Marcação de número: tique bem suave. */
  mark(): void {
    const e = this.env();
    if (!e) return;
    tone(e.v, e.d, { freq: 880, t: e.t, dur: 0.07, gain: 0.07 });
    tone(e.v, e.d, { freq: 1320, t: e.t + 0.02, dur: 0.06, gain: 0.04 });
  }

  /** "Falta 1": brilho ascendente. */
  almost(): void {
    const e = this.env();
    if (!e) return;
    [88, 91, 95, 100].forEach((m, i) => this.bell(e.v, e.d, e.t + i * 0.07, m - 12, 0.1, 0.7));
  }

  smallWin(): void {
    const e = this.env();
    if (!e) return;
    [72, 76, 79, 84].forEach((m, i) => this.bell(e.v, e.d, e.t + i * 0.09, m, 0.16, 0.6));
  }

  /** Moedas: `count` pings metálicos que aceleram levemente. */
  coins(count = 8): void {
    const e = this.env();
    if (!e) return;
    const scale = [84, 88, 91, 93, 96];
    let t = e.t;
    for (let i = 0; i < Math.min(count, 24); i++) {
      const m = scale[(i * 2 + (i % 3)) % scale.length];
      tone(e.v, e.d, { freq: midiHz(m), t, dur: 0.16, gain: 0.1, type: 'triangle' });
      tone(e.v, e.d, { freq: midiHz(m) * 1.5, t: t + 0.01, dur: 0.1, gain: 0.05 });
      t += 0.075 - Math.min(0.03, i * 0.002);
    }
  }

  bigWin(): void {
    const e = this.env();
    if (!e) return;
    const seq = [72, 76, 79, 84, 88, 91, 96];
    seq.forEach((m, i) => this.bell(e.v, e.d, e.t + i * 0.08, m, 0.17, 0.9));
    const tEnd = e.t + seq.length * 0.08;
    [72, 79, 84, 88].forEach((m) => this.bell(e.v, e.d, tEnd, m, 0.12, 1.4));
    noiseHit(e.v, e.d, { t: tEnd, dur: 0.8, gain: 0.04, filter: 'highpass', freq: 6000, attack: 0.02 });
  }

  /** Fanfarra de bingo (usada quando a música não está tocando). */
  bingoFanfare(): void {
    const e = this.env();
    if (!e) return;
    const brass = (t: number, root: number, dur: number) => {
      for (const o of [0, 4, 7, 12]) {
        for (const det of [-7, 7]) {
          tone(e.v, e.d, {
            type: 'sawtooth',
            freq: midiHz(root + o),
            detune: det,
            t,
            dur,
            gain: 0.05,
            attack: 0.025,
            cutoff: [800, 3200],
          });
        }
      }
    };
    [0, 0.16, 0.32].forEach((o) => brass(e.t + o, 60, 0.2));
    brass(e.t + 0.52, 65, 0.25);
    brass(e.t + 0.8, 67, 1.6);
    tone(e.v, e.d, { freq: 100, glideTo: 50, t: e.t, dur: 0.3, gain: 0.5 });
    for (let i = 0; i < 10; i++) this.bell(e.v, e.d, e.t + 0.9 + i * 0.07, 84 + [0, 4, 7, 12, 16][i % 5], 0.1, 0.8);
    noiseHit(e.v, e.d, { t: e.t + 0.8, dur: 1.2, gain: 0.05, filter: 'highpass', freq: 5000, attack: 0.03 });
  }

  dispose(): void {
    this.voices?.stopAll();
    this.voices = null;
    this.lastCtx = null;
  }
}
