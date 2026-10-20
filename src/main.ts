import { bus } from './events';
import { createGame } from './game';
import { createAudio } from './audio';
import { mountUI, setSpokenCaption } from './ui';

const root = document.getElementById('app')!;
const audio = createAudio(bus);
const game = createGame(audio);
const ui = mountUI(root, game);

audio.onCaption(setSpokenCaption);
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

// Modo leve automático: só depois de 3 rodadas, medindo o FPS durante o sorteio.
// Nunca sobrescreve a escolha manual (o jogo ignora `lightManual:false` se já houver escolha).
function watchFps(): void {
  let frames = 0;
  let start = 0;
  function tick(t: number): void {
    if (!start) start = t;
    frames++;
    if (t - start >= 3000) {
      const fps = (frames * 1000) / (t - start);
      if (fps < 24 && !game.getView().settings.light) game.updateSettings({ light: true, lightManual: false });
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
let rounds = 0;
bus.on('roundStart', () => {
  if (++rounds === 4) watchFps();
});
// prefers-reduced-motion só sugere o padrão na primeira abertura.
try {
  if (!localStorage.getItem('altina-da-sorte:rm') && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    game.updateSettings({ light: true, lightManual: false });
  }
  localStorage.setItem('altina-da-sorte:rm', '1');
} catch {
  /* ignora */
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
