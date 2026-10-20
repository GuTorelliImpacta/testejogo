import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipPlayer, SpeechHandle } from '../src/audio/engine';
import { Narrator } from '../src/audio/narrator';
import type { SynthSpeaker } from '../src/audio/narrator';
import { LINE_BY_ID, VOICE_LINES, numberId, numberWord, prizeIds, PRIORITY } from '../src/audio/script';
import { PATTERN_ORDER } from '../src/types';

/** Motor falso: cada play() cria uma fala que só termina quando o teste manda. */
class FakeClips implements ClipPlayer {
  available: Set<string> | 'all' = 'all';
  started: string[] = [];
  stopped: string[] = [];
  active = new Map<string, () => void>();
  has(id: string) {
    return this.available === 'all' || this.available.has(id);
  }
  play(id: string): SpeechHandle | null {
    if (!this.has(id)) return null;
    this.started.push(id);
    let res!: () => void;
    const done = new Promise<void>((r) => (res = r));
    this.active.set(id, res);
    return {
      done,
      stop: () => {
        this.stopped.push(id);
        this.active.delete(id);
        res();
      },
    };
  }
  /** Termina naturalmente a fala `id`. */
  finish(id: string) {
    const r = this.active.get(id);
    this.active.delete(id);
    r?.();
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('roteiro', () => {
  it('tem números 1..60 por extenso e variações de prêmio', () => {
    for (let n = 1; n <= 60; n++) expect(LINE_BY_ID.has(numberId(n))).toBe(true);
    expect(LINE_BY_ID.get('n01')!.text).toBe('Um!');
    expect(LINE_BY_ID.get('n60')!.text).toBe('Sessenta!');
    expect(numberWord(47)).toBe('Quarenta e sete');
    for (const p of PATTERN_ORDER) expect(prizeIds(p).length).toBeGreaterThanOrEqual(2);
    expect(new Set(VOICE_LINES.map((l) => l.id)).size).toBe(VOICE_LINES.length);
  });
  it('bingo tem prioridade máxima', () => {
    expect(LINE_BY_ID.get('prize_bingo_1')!.priority).toBe(PRIORITY.bingo);
    expect(LINE_BY_ID.get('jackpot_1')!.priority).toBe(PRIORITY.bingo);
    expect(LINE_BY_ID.get('prize_linha_1')!.priority).toBe(PRIORITY.prize);
  });
});

describe('Narrator', () => {
  let clips: FakeClips;
  let nar: Narrator;
  let captions: string[];
  let active: boolean[];

  beforeEach(() => {
    clips = new FakeClips();
    captions = [];
    active = [];
    nar = new Narrator({
      clips,
      onCaption: (t) => captions.push(t),
      onActive: (a) => active.push(a),
    });
  });
  afterEach(() => vi.useRealTimers());

  it('números nunca se sobrepõem: o segundo espera o primeiro', async () => {
    const p1 = nar.say('n05');
    const p2 = nar.say('n06');
    expect(clips.started).toEqual(['n05']);
    clips.finish('n05');
    await p1;
    await flush();
    expect(clips.started).toEqual(['n05', 'n06']);
    expect(clips.active.size).toBe(1);
    clips.finish('n06');
    await p2;
  });

  it('a Promise resolve só quando a fala termina', async () => {
    let done = false;
    void nar.say('n10').then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    clips.finish('n10');
    await flush();
    expect(done).toBe(true);
  });

  it('prêmio cancela número em andamento', async () => {
    const pn = nar.say('n10');
    const pp = nar.say('prize_linha_1');
    await pn; // cancelada resolve
    expect(clips.stopped).toEqual(['n10']);
    expect(clips.started).toEqual(['n10', 'prize_linha_1']);
    clips.finish('prize_linha_1');
    await pp;
  });

  it('bingo cancela prêmio; prêmio não cancela bingo', async () => {
    void nar.say('prize_linha_1');
    void nar.say('prize_bingo_1');
    expect(clips.stopped).toEqual(['prize_linha_1']);
    expect(clips.started).toEqual(['prize_linha_1', 'prize_bingo_1']);
    void nar.say('prize_u_1');
    expect(clips.stopped).toEqual(['prize_linha_1']); // bingo segue tocando
    clips.finish('prize_bingo_1');
    await flush();
    expect(clips.started[clips.started.length - 1]).toBe('prize_u_1');
  });

  it('prioridade menor não cancela maior e espera na fila', async () => {
    void nar.say('prize_cantos_1');
    const pn = nar.say('n07');
    expect(clips.stopped).toEqual([]);
    expect(clips.started).toEqual(['prize_cantos_1']);
    clips.finish('prize_cantos_1');
    await flush();
    expect(clips.started).toEqual(['prize_cantos_1', 'n07']);
    clips.finish('n07');
    await pn;
  });

  it('a fila toca por prioridade e depois por ordem de chegada', async () => {
    void nar.say('n01'); // tocando
    void nar.say('n02');
    void nar.say('almost_1', { preempt: false });
    void nar.say('prize_linha_1', { preempt: false });
    void nar.say('n03');
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = [...clips.active.keys()][0];
      order.push(id);
      clips.finish(id);
      await flush();
    }
    expect(order).toEqual(['n01', 'prize_linha_1', 'almost_1', 'n02', 'n03']);
  });

  it('preempt:false não corta a fala atual mesmo com prioridade maior', async () => {
    void nar.say('n20');
    void nar.say('prize_linha_1', { preempt: false });
    expect(clips.stopped).toEqual([]);
    clips.finish('n20');
    await flush();
    expect(clips.started).toEqual(['n20', 'prize_linha_1']);
  });

  it('prioridade maior descarta da fila o que é menor', async () => {
    void nar.say('n01');
    const q = nar.say('n02');
    void nar.say('prize_linha_1');
    await q; // descartado resolve
    expect(clips.started).toEqual(['n01', 'prize_linha_1']);
    clips.finish('prize_linha_1');
    await flush();
    expect(clips.started).toEqual(['n01', 'prize_linha_1']); // n02 nunca tocou
  });

  it('comentários são descartados quando há fala em andamento', async () => {
    void nar.say('n01');
    await nar.say('start_1'); // resolve na hora, sem tocar
    expect(clips.started).toEqual(['n01']);
    expect(nar.pending).toBe(1);
  });

  it('modo acelerado narra só prêmios', async () => {
    nar.setFast(true);
    await nar.say('n01');
    await nar.say('almost_1');
    expect(clips.started).toEqual([]);
    void nar.say('prize_moldura_1');
    expect(clips.started).toEqual(['prize_moldura_1']);
    nar.setFast(false);
    void nar.say('n02');
    expect(nar.pending).toBe(2);
  });

  it('idle() resolve quando a fila esvazia', async () => {
    void nar.say('n01');
    void nar.say('n02');
    let idle = false;
    void nar.idle().then(() => (idle = true));
    clips.finish('n01');
    await flush();
    expect(idle).toBe(false);
    clips.finish('n02');
    await flush();
    expect(idle).toBe(true);
    await expect(nar.idle()).resolves.toBeUndefined();
  });

  it('emite legenda a cada fala e limpa ao esvaziar; informa atividade para o ducking', async () => {
    void nar.say('n01');
    clips.finish('n01');
    await flush();
    expect(captions).toEqual(['Um!', '']);
    expect(active).toEqual([true, false]);
  });

  it('expireMs descarta item que esperou demais', async () => {
    vi.useFakeTimers();
    void nar.say('prize_linha_1');
    const p = nar.say('almost_1', { preempt: false, expireMs: 1000 });
    vi.advanceTimersByTime(1500);
    clips.finish('prize_linha_1');
    await p;
    await flush();
    expect(clips.started).toEqual(['prize_linha_1']);
  });

  it('sem clipe usa o speechSynthesis com estilo animado', async () => {
    clips.available = new Set();
    const spoken: Array<{ text: string; rate: number; pitch: number }> = [];
    const synth: SynthSpeaker = {
      speak(text, style) {
        spoken.push({ text, ...style });
        return { done: Promise.resolve(), stop() {} };
      },
    };
    const n = new Narrator({ clips, synth, getVolume: () => 0.8 });
    await n.say('prize_linha_1');
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('Linha!');
    expect(spoken[0].pitch).toBeGreaterThan(1.2);
    expect(clips.started).toEqual([]);
  });

  it('sem clipe e sem síntese, estima a duração só com a legenda', async () => {
    vi.useFakeTimers();
    clips.available = new Set();
    let done = false;
    void nar.say('n12').then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    vi.advanceTimersByTime(1500);
    await flush();
    expect(done).toBe(true);
    expect(captions[0]).toBe('Doze!');
  });

  it('mudo: não toca clipes, mas resolve rápido com legenda', async () => {
    vi.useFakeTimers();
    const n = new Narrator({ clips, isMuted: () => true, onCaption: (t) => captions.push(t) });
    let done = false;
    void n.say('n12').then(() => (done = true));
    vi.advanceTimersByTime(1300);
    await flush();
    expect(done).toBe(true);
    expect(clips.started).toEqual([]);
  });

  it('clear() cancela tudo e resolve as promessas', async () => {
    const a = nar.say('n01');
    const b = nar.say('n02');
    nar.clear();
    await Promise.all([a, b]);
    expect(nar.pending).toBe(0);
    expect(clips.stopped).toEqual(['n01']);
  });
});
