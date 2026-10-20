// Aba "Aparelho" do painel (SPEC-v3 3.5.1): dados do tablet + FPS / pior quadro das últimas rodadas.
// O coletor de FPS usa requestAnimationFrame SÓ durante o sorteio (nunca em idle, nunca com a aba oculta,
// pausa na oferta de bola extra) e guarda no máximo as últimas 5 rodadas. Compatível com Chrome/WebView ~60.
import type { Bus } from './events';
import type { DeviceInfo } from './types';

/** Rodadas lembradas (janela do FPS médio / pior quadro). */
export const PERF_WINDOW = 5;
/** Rodada só conta para o modo econômico automático se teve quadros suficientes (Turbo não tem). */
export const MIN_FRAMES = 40;
/** Abaixo disso (FPS médio) o modo econômico automático liga. */
export const LOW_FPS = 24;
/** Quantas rodadas medidas antes de decidir (regra de 3 rodadas). */
export const AUTO_ROUNDS = 3;

export interface RoundPerf {
  frames: number;
  fps: number;
  worstMs: number;
}

export interface PerfCollector {
  /** Liga os eventos do barramento (roundStart/roundEnd/extraOffer/extraBought); devolve a função que desliga. */
  attach(bus: Bus): () => void;
  /** Últimas rodadas medidas (no máximo `PERF_WINDOW`), da mais antiga para a mais nova. */
  rounds(): RoundPerf[];
  /** FPS médio (frames/tempo) e pior quadro das últimas rodadas; `null` sem dados. */
  summary(): { fpsMedio: number | null; piorQuadroMs: number | null };
  /** Registra o modo econômico atual (aparece na aba Aparelho). */
  setEconomy(on: boolean): void;
  economy(): boolean;
  /** Chamado ao fim de cada rodada medida, com as rodadas guardadas. */
  onRound(cb: (rounds: RoundPerf[]) => void): void;
  /** Teste: encerra tudo. */
  dispose(): void;
}

export function createPerfCollector(): PerfCollector {
  const done: RoundPerf[] = [];
  let eco = false;
  let cb: ((r: RoundPerf[]) => void) | null = null;
  let running = false; // rodada em andamento (sorteio)
  let paused = false; // oferta de extra / aba oculta
  let raf = 0;
  let last = 0;
  let frames = 0;
  let sum = 0;
  let worst = 0;

  function tick(t: number): void {
    raf = 0;
    if (!running || paused) return;
    if (last) {
      const dt = t - last;
      // intervalos enormes = aba em segundo plano / travada pelo sistema, não medem o jogo
      if (dt < 1000) {
        frames++;
        sum += dt;
        if (dt > worst) worst = dt;
      }
    }
    last = t;
    raf = requestAnimationFrame(tick);
  }
  function arm(): void {
    last = 0;
    if (!raf && running && !paused) raf = requestAnimationFrame(tick);
  }
  function stopLoop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }
  function start(): void {
    stopLoop();
    running = true;
    paused = false;
    frames = 0;
    sum = 0;
    worst = 0;
    arm();
  }
  function end(): void {
    if (!running) return;
    running = false;
    stopLoop();
    if (frames > 0 && sum > 0) {
      done.push({ frames, fps: (frames * 1000) / sum, worstMs: worst });
      while (done.length > PERF_WINDOW) done.shift();
      if (cb) cb(done.slice());
    }
  }
  const onVis = (): void => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      paused = true;
      stopLoop();
    } else if (paused && running) {
      paused = false;
      arm();
    }
  };

  return {
    attach(bus) {
      const offs = [
        bus.on('roundStart', start),
        bus.on('roundEnd', end),
        bus.on('extraOffer', () => {
          paused = true;
          stopLoop();
        }),
        bus.on('extraBought', () => {
          if (running) {
            paused = false;
            arm();
          }
        }),
      ];
      document.addEventListener('visibilitychange', onVis);
      return () => {
        offs.forEach((f) => f());
        document.removeEventListener('visibilitychange', onVis);
      };
    },
    rounds: () => done.slice(),
    summary() {
      let f = 0;
      let s = 0;
      let w: number | null = null;
      for (const r of done) {
        f += r.frames;
        s += r.frames / Math.max(1e-6, r.fps);
        if (w === null || r.worstMs > w) w = r.worstMs;
      }
      return { fpsMedio: s > 0 ? f / s : null, piorQuadroMs: w };
    },
    setEconomy(on) {
      eco = on;
    },
    economy: () => eco,
    onRound(f) {
      cb = f;
    },
    dispose() {
      running = false;
      stopLoop();
      cb = null;
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}

/** Coletor único do app (main.ts liga ao barramento). */
export const perfCollector: PerfCollector = createPerfCollector();

// ---------------------------------------------------------------- versão do cache do service worker
let swVersion = '';
/** Lê a versão do cache do SW (nome `altina-shell-<versão>`); chamar depois de registrar o SW. */
export function refreshSwVersion(): void {
  try {
    if (typeof caches === 'undefined' || !caches.keys) return;
    caches
      .keys()
      .then((keys) => {
        const k = keys.filter((x) => x.indexOf('altina-shell-') === 0).sort().pop();
        swVersion = k ? k.slice('altina-shell-'.length) : '';
      })
      .catch(() => {});
  } catch {
    /* sem Cache Storage */
  }
}

// ---------------------------------------------------------------- dados do aparelho
/** Versão do Chrome/WebView pelo userAgent ("Chrome/72.0.3626.121" -> "72.0.3626.121"). */
export function parseChromeVersion(ua: string): string | null {
  const m = /(?:Chrome|CriOS|Chromium)\/(\d+(?:\.\d+){0,3})/.exec(ua);
  return m ? m[1] : null;
}

export function getDeviceInfo(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const perfMem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const { fpsMedio, piorQuadroMs } = perfCollector.summary();
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    userAgent: nav.userAgent || '',
    chromeVersion: parseChromeVersion(nav.userAgent || ''),
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null,
    screen: `${screen.width}x${screen.height} @${Math.round(dpr * 100) / 100}`,
    viewport: `${innerWidth}x${innerHeight}`,
    dpr: Math.round(dpr * 100) / 100,
    fpsMedio: fpsMedio === null ? null : Math.round(fpsMedio * 10) / 10,
    piorQuadroMs: piorQuadroMs === null ? null : Math.round(piorQuadroMs),
    memoriaJsMB: perfMem && typeof perfMem.usedJSHeapSize === 'number' ? Math.round((perfMem.usedJSHeapSize / 1048576) * 10) / 10 : null,
    modoEconomico: perfCollector.economy(),
    sw: swVersion,
  };
}

// ---------------------------------------------------------------- modo econômico automático
/** Motivo do modo econômico automático por hardware (SPEC 3.5.5): memória ≤ 2 GB ou ≤ 4 núcleos. */
export function lowEndReason(nav: { deviceMemory?: number; hardwareConcurrency?: number } = navigator as Navigator & { deviceMemory?: number }): string | null {
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return 'memoria';
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4) return 'nucleos';
  return null;
}

/** FPS baixo nas primeiras rodadas: `AUTO_ROUNDS` rodadas com quadros suficientes e média abaixo de `LOW_FPS`. */
export function lowFps(rounds: RoundPerf[]): boolean {
  const ok = rounds.filter((r) => r.frames >= MIN_FRAMES);
  if (ok.length < AUTO_ROUNDS) return false;
  const last = ok.slice(-AUTO_ROUNDS);
  let f = 0;
  let s = 0;
  for (const r of last) {
    f += r.frames;
    s += r.frames / Math.max(1e-6, r.fps);
  }
  return s > 0 && f / s < LOW_FPS;
}
