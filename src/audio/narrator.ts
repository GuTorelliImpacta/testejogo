// Fila de narração com prioridades. Independe de DOM/WebAudio: recebe um ClipPlayer e,
// opcionalmente, um SynthSpeaker (speechSynthesis) como fallback.
import type { ClipPlayer, SpeechHandle } from './engine';
import { LINE_BY_ID, PRIORITY } from './script';
import type { VoiceLine } from './script';

export interface SynthStyle {
  rate: number;
  pitch: number;
  volume: number;
}

export interface SynthSpeaker {
  speak(text: string, style: SynthStyle): SpeechHandle | null;
}

export interface NarratorOptions {
  clips: ClipPlayer;
  synth?: SynthSpeaker | null;
  /** Volume da voz (0..1) para o fallback speechSynthesis. */
  getVolume?: () => number;
  /** Quando true, não emite som: só a legenda e uma pausa curta. */
  isMuted?: () => boolean;
  /** Legenda: texto ao começar cada fala; '' quando a fila esvazia. */
  onCaption?: (text: string) => void;
  /** true quando alguma fala começa, false quando a fila esvazia (ducking). */
  onActive?: (active: boolean) => void;
}

export interface SayOptions {
  /** Maior prioridade cancela a fala em andamento (padrão true). */
  preempt?: boolean;
  /** Descarta se já houver fala em andamento/na fila (padrão: true para comentários). */
  dropIfBusy?: boolean;
  /** Descarta se esperar mais que isto na fila. */
  expireMs?: number;
}

interface Item {
  line: VoiceLine;
  opts: SayOptions;
  seq: number;
  queuedAt: number;
  resolve: () => void;
  handle?: SpeechHandle;
  finished: boolean;
}

/** Categorias que o modo acelerado/Turbo não narra. */
const SUPPRESSED_WHEN_FAST: ReadonlySet<VoiceLine['category']> = new Set(['number', 'bordao', 'almost']);

/** True se o modo acelerado cala esta fala (para o áudio não tocar o efeito dela). */
export const suppressedWhenFast = (line: VoiceLine): boolean => SUPPRESSED_WHEN_FAST.has(line.category);

/** Rede de segurança: nenhuma fala segura a fila por mais que isto (M12). */
export const maxSpeechMs = (text: string): number => Math.max(8000, estimateMs(text) * 3);

/** Duração estimada de uma fala sem áudio (só legenda). */
export const estimateMs = (text: string): number => Math.min(3500, Math.max(500, 350 + text.length * 70));

function timerHandle(ms: number): SpeechHandle {
  let t: ReturnType<typeof setTimeout>;
  let res!: () => void;
  const done = new Promise<void>((r) => {
    res = r;
    t = setTimeout(r, ms);
  });
  return {
    done,
    stop() {
      clearTimeout(t);
      res();
    },
  };
}

export class Narrator {
  private cur: Item | null = null;
  private queue: Item[] = [];
  private seq = 0;
  private fast = false;
  private waiters: Array<() => void> = [];
  private disposed = false;
  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(private o: NarratorOptions) {}

  setFast(v: boolean): void {
    this.fast = v;
  }

  get speaking(): boolean {
    return this.cur !== null;
  }
  get pending(): number {
    return this.queue.length + (this.cur ? 1 : 0);
  }
  /** Categoria da fala em andamento (undefined se nenhuma). */
  get currentCategory(): VoiceLine['category'] | undefined {
    return this.cur?.line.category;
  }
  /** Prioridade da fala em andamento (0 se nenhuma). */
  get currentPriority(): number {
    return this.cur ? this.cur.line.priority : 0;
  }

  /** Fala uma linha do roteiro. A Promise resolve quando ela termina (ou é cancelada/descartada). */
  say(lineOrId: string | VoiceLine, opts: SayOptions = {}): Promise<void> {
    const line = typeof lineOrId === 'string' ? LINE_BY_ID.get(lineOrId) : lineOrId;
    if (!line || this.disposed) return Promise.resolve();
    // modo acelerado: só prêmios (e comentários), nunca número/falta 1
    if (this.fast && SUPPRESSED_WHEN_FAST.has(line.category)) return Promise.resolve();
    const busy = this.cur !== null || this.queue.length > 0;
    const dropIfBusy = opts.dropIfBusy ?? line.priority <= PRIORITY.comment;
    if (dropIfBusy && busy) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const item: Item = { line, opts, seq: this.seq++, queuedAt: Date.now(), resolve, finished: false };
      const cur = this.cur;
      if (cur && opts.preempt !== false && line.priority > cur.line.priority) {
        // cancela o que for menos importante (fila e fala atual)
        this.queue = this.queue.filter((q) => {
          if (q.line.priority < line.priority) {
            this.finish(q);
            return false;
          }
          return true;
        });
        this.queue.push(item);
        this.finish(cur, true);
        this.pump();
        return;
      }
      this.queue.push(item);
      this.pump();
    });
  }

  /** Resolve quando não há fala em andamento nem na fila. */
  idle(): Promise<void> {
    if (!this.cur && this.queue.length === 0) return Promise.resolve();
    return new Promise<void>((r) => this.waiters.push(r));
  }

  /** Cancela tudo. */
  clear(): void {
    const items = [...this.queue];
    this.queue = [];
    for (const q of items) this.finish(q);
    if (this.cur) this.finish(this.cur, true);
    this.pump();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  // ---------- interno ----------
  private pickNext(): Item | null {
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (best < 0 || q.line.priority > this.queue[best].line.priority) best = i;
      // empate: mantém o primeiro (FIFO), pois seq cresce com o índice
    }
    return best < 0 ? null : this.queue.splice(best, 1)[0];
  }

  private pump(): void {
    while (!this.cur) {
      const next = this.pickNext();
      if (!next) break;
      const exp = next.opts.expireMs;
      if (exp !== undefined && Date.now() - next.queuedAt > exp) {
        this.finish(next);
        continue;
      }
      this.start(next);
    }
    if (!this.cur && this.queue.length === 0) {
      this.o.onCaption?.('');
      this.o.onActive?.(false);
      const w = this.waiters;
      this.waiters = [];
      for (const r of w) r();
    }
  }

  private start(item: Item): void {
    const wasIdle = this.cur === null;
    this.cur = item;
    if (wasIdle) this.o.onActive?.(true);
    const line = item.line;
    let h: SpeechHandle | null = null;
    // a legenda é exatamente o texto que está sendo dito (clipe = texto do roteiro; voz sintetizada = texto enviado)
    let caption = line.text;
    if (this.o.isMuted?.()) {
      h = timerHandle(Math.min(estimateMs(line.text) * 0.6, 1200));
    } else {
      if (this.o.clips.has(line.id)) h = this.o.clips.play(line.id);
      if (!h && this.o.synth) {
        caption = line.speak ?? line.text;
        h = this.o.synth.speak(caption, this.styleFor(line));
      }
      if (!h) {
        caption = line.text;
        h = timerHandle(estimateMs(line.text));
      }
    }
    this.o.onCaption?.(caption);
    item.handle = h;
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.cur === item) this.finish(item, true, true);
    }, maxSpeechMs(line.text));
    void h.done.then(() => {
      if (this.cur === item) this.finish(item, false, true);
    });
  }

  private styleFor(line: VoiceLine): SynthStyle {
    const j = (Math.random() - 0.5) * 0.1;
    const big = line.energy === 'big';
    const isNum = line.category === 'number';
    return {
      rate: (isNum ? 1.1 : big ? 0.95 : 1.02) + j,
      pitch: (isNum ? 1.2 : big ? 1.45 : 1.25) + j,
      volume: this.o.getVolume ? this.o.getVolume() : 1,
    };
  }

  /** Encerra um item (stop opcional); se era o atual, libera a vaga. */
  private finish(item: Item, stop = false, pumpAfter = false): void {
    if (item.finished) return;
    item.finished = true;
    if (stop) item.handle?.stop();
    if (this.cur === item) {
      this.cur = null;
      clearTimeout(this.watchdog);
    }
    item.resolve();
    if (pumpAfter) this.pump();
  }
}

// ---------- speechSynthesis (fallback) ----------

export function createSynthSpeaker(): SynthSpeaker | null {
  const g = globalThis as any;
  const synth: SpeechSynthesis | undefined = g.speechSynthesis;
  if (!synth || typeof g.SpeechSynthesisUtterance !== 'function') return null;
  let voice: SpeechSynthesisVoice | null = null;
  const choose = () => {
    const all = synth.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('pt-br'));
    voice = all.find((v) => /natural|online|google|francisca|thalita|luciana|antonio/i.test(v.name)) ?? all[0] ?? null;
  };
  choose();
  try {
    synth.addEventListener('voiceschanged', choose);
  } catch {
    /* ignora */
  }
  return {
    speak(text, style) {
      let res!: () => void;
      let finished = false;
      const done = new Promise<void>((r) => (res = r));
      const end = () => {
        if (finished) return;
        finished = true;
        clearTimeout(safety);
        res();
      };
      const u = new g.SpeechSynthesisUtterance(text) as SpeechSynthesisUtterance;
      u.lang = 'pt-BR';
      if (voice) u.voice = voice;
      u.rate = style.rate;
      u.pitch = style.pitch;
      u.volume = style.volume;
      u.onend = end;
      u.onerror = end;
      // alguns navegadores nunca disparam onend: rede de segurança
      const safety = setTimeout(end, estimateMs(text) * 2 + 1500);
      try {
        synth.cancel();
        synth.speak(u);
      } catch {
        end();
      }
      return {
        done,
        stop() {
          if (!finished) {
            try {
              synth.cancel();
            } catch {
              /* ignora */
            }
          }
          end();
        },
      };
    },
  };
}
