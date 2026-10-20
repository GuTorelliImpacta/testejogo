// Efeitos sonoros sintetizados (zero download). Todos curtos, originais e suaves.
import type { AudioEngine } from './engine';
import { canPrerender, newOffline, renderCompat } from './compat';
import { Voices, midiHz, noiseHit, tone } from './synth';

export class Sfx {
  private voices: Voices | null = null;
  private lastCtx: BaseAudioContext | null = null;
  /** "Globo girando" pré-renderizado (1 fonte em vez de ~26 nós por bola); 'pend'/'fail' = não usar ainda. */
  private ballBuf = new WeakMap<BaseAudioContext, AudioBuffer | 'pend' | 'fail'>();

  constructor(private engine: AudioEngine) {}

  /** Retorna [voices, destino, t0] ou null se o áudio ainda não foi liberado. */
  private env(): { v: Voices; d: AudioNode; t: number } | null {
    const ctx = this.engine.ctx;
    if (!ctx || !this.engine.audible) return null;
    const wasIdle = this.engine.idleSuspended;
    this.engine.wake(); // retoma o contexto se estava suspenso por ociosidade (o efeito toca assim que voltar)
    if (ctx.state !== 'running' && !wasIdle) return null;
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

  /**
   * Globo girando e a bola rolando até sair (≤ 400 ms): zumbido de ruído, estalinhos de
   * bolas batendo que aceleram e um "toc" final.
   */
  ballDraw(): void {
    const e = this.env();
    if (!e) return;
    const { v, d, t } = e;
    const ctx = v.ctx;
    const cached = this.ballBuf.get(ctx);
    if (cached && cached !== 'pend' && cached !== 'fail') {
      // mesmo som, 1 fonte + 1 ganho: cada nó criado custa na thread principal (tablet fraco)
      const src = ctx.createBufferSource();
      src.buffer = cached;
      src.connect(d);
      v.run(src, t, cached.duration, []);
      return;
    }
    if (!cached && canPrerender()) this.prerenderBall(ctx);
    this.buildBallDraw(v, d, t);
  }

  /** Renderiza uma vez, em tempo ocioso, o mesmo grafo de `buildBallDraw` num OfflineAudioContext. */
  private prerenderBall(ctx: BaseAudioContext): void {
    this.ballBuf.set(ctx, 'pend');
    const go = () => {
      try {
        const sr = ctx.sampleRate;
        const off = newOffline(1, Math.ceil(0.5 * sr), sr);
        this.buildBallDraw(new Voices(off, true), off.destination, 0);
        renderCompat(off).then(
          (b) => this.ballBuf.set(ctx, b),
          () => this.ballBuf.set(ctx, 'fail'),
        );
      } catch {
        this.ballBuf.set(ctx, 'fail');
      }
    };
    setTimeout(go, 400);
  }

  private buildBallDraw(v: Voices, d: AudioNode, t: number): void {
    noiseHit(v, d, { t, dur: 0.24, gain: 0.05, filter: 'bandpass', freq: 520, q: 1.2, attack: 0.05 });
    noiseHit(v, d, { t: t + 0.06, dur: 0.2, gain: 0.035, filter: 'bandpass', freq: 1150, q: 1.5, attack: 0.05 });
    let at = t + 0.01;
    let gap = 0.062;
    for (let i = 0; i < 5; i++) {
      noiseHit(v, d, { t: at, dur: 0.025, gain: 0.15, filter: 'bandpass', freq: 1700 + i * 260, q: 3 });
      at += gap;
      gap *= 0.85;
    }
    tone(v, d, { freq: 520, glideTo: 780, t: t + 0.3, dur: 0.09, gain: 0.2, type: 'triangle' });
  }

  /** Turbo: só um tique no lugar do globo. */
  tick(): void {
    const e = this.env();
    if (!e) return;
    tone(e.v, e.d, { freq: 1150, t: e.t, dur: 0.035, gain: 0.08, type: 'triangle' });
  }

  /** "Plim" dourado: bola extra grátis e correio da sorte. */
  plim(): void {
    const e = this.env();
    if (!e) return;
    this.bell(e.v, e.d, e.t, 96, 0.13, 0.9);
    this.bell(e.v, e.d, e.t + 0.09, 103, 0.11, 1.1);
    this.bell(e.v, e.d, e.t + 0.18, 108, 0.07, 1.3);
    noiseHit(e.v, e.d, { t: e.t + 0.05, dur: 0.5, gain: 0.02, filter: 'highpass', freq: 8000, attack: 0.02 });
  }

  /** Linha: arpejo curto e luminoso (~1 s). */
  jingleLinha(): void {
    const e = this.env();
    if (!e) return;
    [76, 79, 83, 88].forEach((m, i) => this.bell(e.v, e.d, e.t + i * 0.08, m, 0.15, 0.7));
    this.bell(e.v, e.d, e.t + 0.4, 91, 0.1, 0.9);
  }

  /** Linha dupla: duas subidas seguidas e acorde brilhante (~1,8 s). */
  jingleLinhaDupla(): void {
    const e = this.env();
    if (!e) return;
    [72, 76, 79, 84].forEach((m, i) => this.bell(e.v, e.d, e.t + i * 0.075, m, 0.15, 0.6));
    [79, 83, 86, 91].forEach((m, i) => this.bell(e.v, e.d, e.t + 0.42 + i * 0.075, m, 0.16, 0.7));
    const tc = e.t + 0.8;
    [79, 84, 88, 91, 96].forEach((m) => this.bell(e.v, e.d, tc, m, 0.1, 1.2));
    this.coins(5);
  }

  /** Acumulado: chuva de sinos descendo e acorde grande (~3 s). */
  jingleJackpot(): void {
    const e = this.env();
    if (!e) return;
    const sc = [96, 93, 91, 88, 84, 81, 79, 76];
    for (let i = 0; i < 16; i++) this.bell(e.v, e.d, e.t + i * 0.085, sc[i % sc.length], 0.11, 0.8);
    const tc = e.t + 1.45;
    [60, 67, 72, 76, 79, 84].forEach((m) => this.bell(e.v, e.d, tc, m, 0.12, 2.0));
    tone(e.v, e.d, { freq: 90, glideTo: 55, t: tc, dur: 0.4, gain: 0.4 });
    noiseHit(e.v, e.d, { t: tc, dur: 1.4, gain: 0.04, filter: 'highpass', freq: 6000, attack: 0.03 });
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
