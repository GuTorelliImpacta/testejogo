import './polyfills';
import { bus } from './events';
import { createGame, handleResetPinParam } from './game';
import { createAudio } from './audio';
import { mountUI, setSpokenCaption } from './ui';
import { lowEndReason, lowFps, perfCollector, refreshSwVersion } from './perf';

const root = document.getElementById('app')!;
const audio = createAudio(bus);
const game = createGame(audio);
const ui = mountUI(root, game);

// ?resetpin=1: o neto volta ao PIN padrão confirmando com o PIN padrão.
try {
  if (handleResetPinParam(game, location.search, () => prompt('Digite o PIN padrão para restaurar:'))) {
    history.replaceState(null, '', location.pathname);
  }
} catch {
  /* ignora */
}

audio.onCaption(setSpokenCaption);
// Modo leve/econômico também deixa o áudio mais leve (música em taxa menor).
let lastLight: boolean | null = null;
function syncEconomy(): void {
  const light = game.getView().settings.light;
  if (light !== lastLight) {
    lastLight = light;
    perfCollector.setEconomy(light);
    audio.setEconomy(light);
  }
}
syncEconomy();
bus.on('stateChanged', () => {
  syncEconomy();
  ui.render();
});
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

// Coletor de FPS / pior quadro: rAF só durante o sorteio (aba "Aparelho" do painel e modo econômico automático).
perfCollector.attach(bus);

// Modo econômico automático (SPEC 3.5.5): liga sozinho em aparelho fraco (deviceMemory <= 2 GB, <= 4 núcleos)
// ou com FPS baixo nas primeiras rodadas (3 rodadas medidas). `lightManual:false` nunca sobrescreve a escolha manual:
// o jogo ignora o pedido se a pessoa já escolheu (ligar ou desligar o Modo leve em Ajustes).
function autoEconomy(): void {
  const s = game.getView().settings;
  if (!s.light && !s.lightManual) game.updateSettings({ light: true, lightManual: false });
}
if (lowEndReason()) autoEconomy();
perfCollector.onRound((rounds) => {
  if (lowFps(rounds)) autoEconomy();
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
  addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(refreshSwVersion)
      .catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', refreshSwVersion);
    refreshSwVersion();
  });
}
