// Compatibilidade Web Audio para tablets antigos (Android 5/6, Chrome/WebView ~60–72).
// - AudioContext sem prefixo ou webkitAudioContext
// - OfflineAudioContext (ou webkitOfflineAudioContext) com o construtor de 3 argumentos (canais, quadros, taxa),
//   o único aceito antes do Chrome 59/ Safari antigo; nada de construtor com objeto de opções
// - decodeAudioData com callbacks (e Promise quando existir): resolve com o que vier primeiro
// - startRendering com Promise OU evento `oncomplete`

type AnyCtor = new (...a: any[]) => any;

export function getContextCtor(): typeof AudioContext | undefined {
  const g = globalThis as any;
  return g.AudioContext ?? g.webkitAudioContext;
}

export function getOfflineCtor(): AnyCtor | undefined {
  const g = globalThis as any;
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
}

/** true se dá para pré-renderizar música neste aparelho. */
export function canPrerender(): boolean {
  return typeof getOfflineCtor() === 'function';
}

/** Construtor de 3 argumentos (funciona em todos os navegadores com Web Audio). */
export function newOffline(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  const C = getOfflineCtor();
  if (!C) throw new Error('OfflineAudioContext indisponível');
  return new C(channels, Math.max(1, Math.round(length)), sampleRate) as OfflineAudioContext;
}

export function renderCompat(off: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let done = false;
    const ok = (b: AudioBuffer) => {
      if (done) return;
      done = true;
      resolve(b);
    };
    const bad = (e: unknown) => {
      if (done) return;
      done = true;
      reject(e);
    };
    try {
      (off as any).oncomplete = (e: { renderedBuffer?: AudioBuffer }) => e?.renderedBuffer && ok(e.renderedBuffer);
      const p: any = off.startRendering();
      if (p && typeof p.then === 'function') p.then(ok, bad);
    } catch (e) {
      bad(e);
    }
  });
}

export function decodeCompat(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let done = false;
    const ok = (b: AudioBuffer) => {
      if (done) return;
      done = true;
      resolve(b);
    };
    const bad = (e?: unknown) => {
      if (done) return;
      done = true;
      reject(e ?? new Error('decodeAudioData falhou'));
    };
    try {
      const p: any = (ctx as any).decodeAudioData(data, ok, bad);
      if (p && typeof p.then === 'function') p.then(ok, bad); // evita "unhandled rejection"
    } catch (e) {
      bad(e);
    }
  });
}
