import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipPlayer, SpeechHandle } from '../src/audio/engine';
import { Narrator, maxSpeechMs } from '../src/audio/narrator';
import { createAudio } from '../src/audio';
import { AudioEngine } from '../src/audio/engine';
import { Bus } from '../src/events';
import type { SynthSpeaker } from '../src/audio/narrator';
import {
  BORDOES,
  LINE_BY_ID,
  VOICE_LINES,
  bordaoId,
  numberId,
  numberWord,
  pickNumberLine,
  prizeIds,
  PRIORITY,
} from '../src/audio/script';
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
  it('tem números 1..90 por extenso e variações de prêmio', () => {
    for (let n = 1; n <= 90; n++) expect(LINE_BY_ID.has(numberId(n))).toBe(true);
    expect(VOICE_LINES.filter((l) => l.category === 'number')).toHaveLength(90);
    expect(LINE_BY_ID.get('n01')!.text).toBe('Um!');
    expect(LINE_BY_ID.get('n90')!.text).toBe('Noventa!');
    expect(numberWord(47)).toBe('Quarenta e sete');
    expect(numberWord(71)).toBe('Setenta e um');
    expect(numberWord(88)).toBe('Oitenta e oito');
    for (const p of PATTERN_ORDER) expect(prizeIds(p).length).toBeGreaterThanOrEqual(2);
    expect(new Set(VOICE_LINES.map((l) => l.id)).size).toBe(VOICE_LINES.length);
  });
  it('tem as falas novas e bordões com número', () => {
    expect(LINE_BY_ID.get('extra_free')!.text).toBe('Bola extra grátis!');
    expect(LINE_BY_ID.get('mail_1')!.text).toBe('Correio da sorte!');
    expect(LINE_BY_ID.get('turbo_1')!.text).toBe('Turbo!');
    expect(LINE_BY_ID.get('extra_linhadupla')!.text).toBe('Linha dupla, valendo!');
    expect(BORDOES[22]).toMatch(/patinhos na lagoa/i);
    for (const n of Object.keys(BORDOES).map(Number)) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(90);
      expect(LINE_BY_ID.get(bordaoId(n))!.category).toBe('bordao');
    }
  });
  it('pickNumberLine: bordão só com setting ligado, número com bordão e ~1/8 de chance', () => {
    expect(pickNumberLine(22, true, () => 0.01)).toBe('bordao_22');
    expect(pickNumberLine(22, true, () => 0.5)).toBe('n22');
    expect(pickNumberLine(22, false, () => 0.01)).toBe('n22');
    expect(pickNumberLine(5, true, () => 0.01)).toBe('n05'); // sem bordão cadastrado
    let hits = 0;
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 4000; i++) if (pickNumberLine(22, true, r) === 'bordao_22') hits++;
    expect(hits / 4000).toBeGreaterThan(0.09);
    expect(hits / 4000).toBeLessThan(0.16);
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

describe('Narrator: modo acelerado, legenda e rede de segurança', () => {
  it('Turbo/acelerado também cala o bordão', async () => {
    const clips = new FakeClips();
    const n = new Narrator({ clips });
    n.setFast(true);
    await n.say('bordao_22');
    expect(clips.started).toEqual([]);
  });

  it('legenda = texto do clipe; com voz sintetizada = texto enviado ao sintetizador; vazia ao terminar', async () => {
    const clips = new FakeClips();
    clips.available = new Set(['prize_linha_1']);
    const captions: string[] = [];
    const synth: SynthSpeaker = { speak: () => ({ done: Promise.resolve(), stop() {} }) };
    const spoken: string[] = [];
    const n = new Narrator({
      clips,
      synth: { speak: (t, st) => (spoken.push(t), synth.speak(t, st)) },
      onCaption: (t) => captions.push(t),
    });
    void n.say('prize_linha_1');
    clips.finish('prize_linha_1');
    await flush();
    await n.say('prize_linha_2'); // sem clipe → sintetizador
    await n.say('bordao_22');
    await n.say('prize_bingo_1'); // speak diferente do texto
    await flush();
    expect(captions.filter(Boolean)).toEqual(['Linhaaa!', 'Linha! Muito bem!', BORDOES[22], 'Bingo!']);
    expect(spoken).toEqual(['Linha! Muito bem!', BORDOES[22], 'Bingo!']);
    expect(captions[captions.length - 1]).toBe('');
  });

  it('M12: fala que nunca termina é encerrada pela rede de segurança', async () => {
    vi.useFakeTimers();
    const clips = new FakeClips();
    const n = new Narrator({ clips });
    let done = false;
    void n.say('n10').then(() => (done = true));
    void n.say('n11');
    vi.advanceTimersByTime(maxSpeechMs('Dez!') + 10);
    await flush();
    expect(done).toBe(true);
    expect(clips.stopped).toEqual(['n10']);
    expect(clips.started).toEqual(['n10', 'n11']); // a fila segue
    vi.useRealTimers();
  });
});

describe('createAudio: eventos novos', () => {
  const setup = (rnd = () => 0.99) => {
    vi.useFakeTimers();
    const bus = new Bus();
    const audio = createAudio(bus, { engine: new AudioEngine({ fetchFn: undefined }), rnd });
    const caps: string[] = [];
    audio.onCaption((c) => caps.push(c));
    const spoken = () => caps.filter(Boolean);
    return { bus, audio, spoken };
  };
  afterEach(() => vi.useRealTimers());

  it('bola extra grátis é falada uma vez, mesmo com freeExtra + extraOffer.free', () => {
    const { bus, spoken, audio } = setup();
    bus.emit('extraOffer', { cost: 0, free: true, remaining: 9, improves: [] });
    bus.emit('freeExtra');
    expect(spoken()).toEqual(['Bola extra grátis!']);
    audio.dispose();
  });

  it('oferta por linha dupla fala "Linha dupla, valendo!"; oferta comum mantém a fala antiga', () => {
    const a = setup();
    a.bus.emit('extraOffer', { cost: 5, free: false, remaining: 9, improves: [{ cardIndex: 0, pattern: 'linhaDupla', gain: 9 }] });
    expect(a.spoken()).toEqual(['Linha dupla, valendo!']);
    a.audio.dispose();
    const b = setup();
    b.bus.emit('extraOffer', { cost: 5, free: false, remaining: 9, improves: [{ cardIndex: 0, pattern: 'bingo', gain: 9 }] });
    expect(b.spoken()).toEqual(['Bola extra! Vai, Dona Altina!']);
    b.audio.dispose();
  });

  it('correio e Turbo', () => {
    const { bus, spoken, audio } = setup();
    bus.emit('mailbox', { kind: 'daily', amount: 300, state: 'arrived' });
    vi.advanceTimersByTime(5000);
    bus.emit('turboChanged', { on: true });
    vi.advanceTimersByTime(5000);
    bus.emit('turboChanged', { on: false });
    expect(spoken()).toEqual(['Correio da sorte!', 'Turbo!']);
    audio.dispose();
  });

  it('Turbo liga o modo acelerado: bola sem voz; bordão só com setBordoes(true) e sorte', async () => {
    const { bus, spoken, audio } = setup(() => 0);
    bus.emit('turboChanged', { on: true });
    await vi.advanceTimersByTimeAsync(5000);
    bus.emit('ballDrawn', { ball: 22, index: 0, total: 30, extra: false, fast: true });
    expect(spoken()).toEqual(['Turbo!']);
    bus.emit('turboChanged', { on: false });
    audio.setBordoes(false);
    bus.emit('ballDrawn', { ball: 22, index: 1, total: 30, extra: false, fast: false });
    expect(spoken().pop()).toBe('Vinte e dois!');
    await vi.advanceTimersByTimeAsync(5000);
    audio.setBordoes(true);
    bus.emit('ballDrawn', { ball: 22, index: 2, total: 30, extra: false, fast: false });
    expect(spoken().pop()).toBe(BORDOES[22]);
    audio.dispose();
  });
});

describe('AudioEngine: M4 (sem requisições de clipes inexistentes)', () => {
  const resp = (ok: boolean, body = '{}') =>
    ({ ok, headers: { get: () => 'application/json' }, json: async () => JSON.parse(body), arrayBuffer: async () => new ArrayBuffer(200) }) as unknown as Response;
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it('sem manifest: só pede os 2 manifests, nenhum clipe', async () => {
    const urls: string[] = [];
    const e = new AudioEngine({ fetchFn: (async (u: string) => (urls.push(u), resp(false))) as unknown as typeof fetch });
    e.preload(['n01', 'n02', 'prize_bingo_1']);
    await settle();
    expect(urls.sort()).toEqual(['/audio/voice-custom/manifest.json', '/audio/voice/manifest.json']);
  });

  it('manifest vazio: nenhum clipe; manifest com ids: só busca o listado', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      if (u.endsWith('voice/manifest.json')) return resp(true, '{"ids":["n02"]}');
      if (u.endsWith('voice-custom/manifest.json')) return resp(true, '{"ids":[]}');
      return resp(true);
    }) as unknown as typeof fetch;
    const e = new AudioEngine({ fetchFn: f });
    e.preload(['n01', 'n02']);
    await settle();
    expect(urls.filter((u) => !u.endsWith('manifest.json'))[0]).toMatch(/\/audio\/voice\/n02\.(webm|mp3)$/);
    expect(urls.some((u) => /n01/.test(u))).toBe(false);
  });
});
