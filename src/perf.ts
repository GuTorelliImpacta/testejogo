import type { DeviceInfo } from './types';

/** Stub: o `perf-pwa-engineer` implementa a coleta real (FPS, pior quadro, memória). */
export function getDeviceInfo(): DeviceInfo {
  return {
    userAgent: navigator.userAgent,
    chromeVersion: null,
    deviceMemory: null,
    cores: null,
    screen: '',
    viewport: '',
    dpr: 1,
    fpsMedio: null,
    piorQuadroMs: null,
    memoriaJsMB: null,
    modoEconomico: false,
    sw: '',
  };
}
