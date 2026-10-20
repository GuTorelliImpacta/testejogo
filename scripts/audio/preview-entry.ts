// Roda DENTRO do Chromium (empacotado por scripts/audio/preview.ts). Renderiza a prévia com OfflineAudioContext.
// Voz: NÃO há clipes de voz reais; cada fala vira um "beep falado" sintético (marca onde a voz entra e
// aciona o ducking real). A voz de verdade entra depois, quando os clipes forem gerados.
import { Bus } from '../../src/events';
import { createAudio } from '../../src/audio';
import { AudioEngine } from '../../src/audio/engine';
import { Music } from '../../src/audio/music';
import type { SpeechHandle } from '../../src/audio/engine';
import { LINE_BY_ID } from '../../src/audio/script';
import { estimateMs } from '../../src/audio/narrator';

const SR = 44100;
const TOTAL_S = 48;
const STEP_S = 0.05;

export interface PreviewResult {
  wavBase64: string;
  peak: number;
  rmsBySecond: number[];
  timeline: Array<{ t: number; what: string }>;
}

// ----- relógio virtual: setTimeout/clearTimeout seguem o tempo do OfflineAudioContext -----
let vnow = 0;
let vseq = 1;
const timers = new Map<number, { at: number; fn: () => void }>();
const realSetTimeout = window.setTimeout.bind(window);
(window as any).setTimeout = (fn: () => void, ms = 0) => {
  const id = vseq++;
  timers.set(id, { at: vnow + Math.max(0, ms), fn });
  return id;
};
(window as any).clearTimeout = (id?: number) => {
  if (id !== undefined) timers.delete(id);
};
function advanceTo(ms: number): void {
  for (;;) {
    let best: [number, { at: number; fn: () => void }] | null = null;
    for (const e of timers) if (e[1].at <= ms && (!best || e[1].at < best[1].at)) best = e;
    if (!best) break;
    timers.delete(best[0]);
    vnow = Math.max(vnow, best[1].at);
    try {
      best[1].fn();
    } catch (err) {
      console.error(err);
    }
  }
  vnow = ms;
}
const sleep = (ms: number) => new Promise<void>((r) => (window as any).setTimeout(r, ms));
const macrotask = () =>
  new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

// ----- engine com "beep falado" no lugar dos clipes -----
class BeepEngine extends AudioEngine {
  log: Array<{ t: number; what: string }> = [];
  override has(): boolean {
    return !!this.ctx;
  }
  override play(id: string): SpeechHandle | null {
    const ctx = this.ctx;
    const line = LINE_BY_ID.get(id);
    if (!ctx || !line) return null;
    const big = line.energy === 'big';
    const dur = Math.min(1.8, estimateMs(line.text) / 1000 * 0.55);
    const t = ctx.currentTime + 0.02;
    // marca a fala: 2 notas (sobem em prêmio); número varia o tom conforme a bola
    const base = line.category === 'number' ? 330 + (Number(id.slice(1)) % 12) * 18 : big ? 520 : 400;
    const notes = big ? [base, base * 1.25, base * 1.5] : [base, base * 1.12];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      o.frequency.value = f;
      const s = t + (i * dur) / notes.length;
      const e = s + dur / notes.length;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.22, s + 0.02);
      g.gain.setValueAtTime(0.22, e - 0.04);
      g.gain.linearRampToValueAtTime(0.0001, e);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.voiceBus);
      o.start(s);
      o.stop(e + 0.02);
    });
    this.log.push({ t: +ctx.currentTime.toFixed(2), what: `voz[beep]: ${line.text}` });
    let res!: () => void;
    const done = new Promise<void>((r) => (res = r));
    const timer = (window as any).setTimeout(res, dur * 1000);
    return {
      done,
      stop: () => {
        (window as any).clearTimeout(timer);
        res();
      },
    };
  }
}

function toWav(l: Float32Array, r: Float32Array): { b64: string; peak: number } {
  const n = l.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  w(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, SR, true);
  dv.setUint32(28, SR * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, n * 4, true);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    for (const [k, ch] of [l, r].entries()) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      peak = Math.max(peak, Math.abs(v));
      dv.setInt16(44 + i * 4 + k * 2, Math.round(v * 32767), true);
    }
  }
  let bin = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { b64: btoa(bin), peak };
}

export async function render(): Promise<PreviewResult> {
  const ctx = new OfflineAudioContext(2, SR * TOTAL_S, SR);
  // o contexto offline só vira "running" ao renderizar; o áudio do jogo exige 'running'
  Object.defineProperty(ctx, 'state', { get: () => 'running' });
  const engine = new BeepEngine({ createContext: () => ctx as unknown as AudioContext });
  const bus = new Bus();
  const timeline: Array<{ t: number; what: string }> = [];
  let forceBordao = false;
  // música pré-renderizada: o trabalho ocioso usa o relógio REAL (o setTimeout da página é virtual aqui)
  const music = new Music(engine, { defer: (fn, ms) => realSetTimeout(fn, ms) });
  const audio = createAudio(bus, { engine, music, rnd: () => (forceBordao ? 0 : 0.99) });
  audio.onCaption((c) => c && timeline.push({ t: +ctx.currentTime.toFixed(2), what: `legenda: ${c}` }));
  audio.setBordoes(true);
  await audio.unlock();
  await music.whenReady(true); // todos os loops e stingers prontos antes de começar a prévia

  const mark = (what: string) => timeline.push({ t: +ctx.currentTime.toFixed(2), what });
  const emit = bus.emit.bind(bus) as (ev: string, p?: unknown) => void;

  // roteiro da prévia (tempo virtual)
  const script = (async () => {
    await sleep(2500);
    mark('roundStart (música passa a "animada")');
    emit('roundStart', { bet: 1, totalBet: 3 });
    await audio.waitForSpeech();
    const draw = async (ball: number, index: number, extra = false, bordao = false) => {
      forceBordao = bordao;
      mark(`ballDrawn ${ball}`);
      emit('ballDrawn', { ball, index, total: extra ? 9 : 30, extra, fast: false });
      await audio.waitForSpeech();
      await sleep(1800);
    };
    await sleep(1000);
    await draw(7, 0);
    await draw(22, 1, false, true); // bordão
    mark('almost (falta 1)');
    emit('almost', { cardIndex: 0, pattern: 'linhaDupla', forBingo: false });
    await audio.waitForSpeech();
    await draw(41, 2);
    mark('patternWon linha');
    emit('patternWon', { cardIndex: 0, pattern: 'linha', prize: 8, ball: 41 });
    await audio.waitForSpeech();
    await sleep(1800);
    await draw(68, 3);
    mark('patternWon linhaDupla');
    emit('patternWon', { cardIndex: 0, pattern: 'linhaDupla', prize: 40, ball: 68 });
    await audio.waitForSpeech();
    await sleep(2200);
    await draw(90, 4);
    mark('extraOffer (grátis)');
    emit('extraOffer', { cost: 0, free: true, remaining: 9, improves: [{ cardIndex: 0, pattern: 'bingo', gain: 200 }] });
    emit('freeExtra');
    await audio.waitForSpeech();
    await sleep(2200);
    emit('extraBought', { cost: 0, number: 1 });
    await audio.waitForSpeech();
    await draw(15, 0, true, true); // extra, bordão
    mark('BINGO');
    emit('patternWon', { cardIndex: 0, pattern: 'bingo', prize: 400, ball: 15 });
    emit('bingo', { cardIndex: 0, viaExtra: true });
    await audio.waitForSpeech();
    await sleep(9000);
    emit('roundEnd', { summary: { prize: 448 }, won: true });
  })();
  void script;

  // render com pausas a cada STEP_S: avança o relógio virtual e deixa as promessas rodarem
  const steps = Math.floor(TOTAL_S / STEP_S);
  for (let k = 1; k < steps; k++) {
    const at = Math.round(k * STEP_S * SR) / SR;
    ctx.suspend(at).then(async () => {
      advanceTo(at * 1000);
      for (let i = 0; i < 4; i++) await macrotask();
      void ctx.resume();
    });
  }
  const out = await ctx.startRendering();
  const l = out.getChannelData(0);
  const r = out.getChannelData(1);
  const { b64, peak } = toWav(l, r);
  const rmsBySecond: number[] = [];
  for (let s = 0; s < TOTAL_S; s++) {
    let acc = 0;
    for (let i = s * SR; i < (s + 1) * SR; i++) acc += l[i] * l[i];
    rmsBySecond.push(+(20 * Math.log10(Math.sqrt(acc / SR) + 1e-9)).toFixed(1));
  }
  return { wavBase64: b64, peak, rmsBySecond, timeline: [...timeline, ...engine.log].sort((a, b) => a.t - b.t) };
}

(window as any).__render = render;
