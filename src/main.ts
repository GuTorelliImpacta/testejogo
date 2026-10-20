import { bus } from './events';
import { createGame } from './game';
import { createAudio } from './audio';
import { mountUI } from './ui';

const root = document.getElementById('app')!;
const audio = createAudio(bus);
const game = createGame(audio);
const ui = mountUI(root, game);

bus.on('stateChanged', () => ui.render());
ui.render();

// Mantém a tela acesa durante a partida (silencioso se não houver suporte).
let lock: WakeLockSentinel | null = null;
async function keepAwake(): Promise<void> {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
    }
  } catch {
    /* ignora */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void keepAwake();
});
addEventListener('pointerdown', () => void keepAwake(), { once: true });

// Modo leve automático: mede o FPS nos primeiros segundos de jogo.
function watchFps(): void {
  let frames = 0;
  let start = 0;
  let checks = 0;
  function tick(t: number): void {
    if (!start) start = t;
    frames++;
    if (t - start >= 3000) {
      const fps = (frames * 1000) / (t - start);
      if (fps < 24 && !game.getView().settings.light) game.updateSettings({ light: true });
      if (++checks >= 2) return;
      frames = 0;
      start = 0;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
if (matchMedia('(prefers-reduced-motion: reduce)').matches) game.updateSettings({ light: true });
else watchFps();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
