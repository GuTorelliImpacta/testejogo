// @ts-nocheck  (script Node)
/**
 * npm run audio:preview  →  docs/qa/audio-preview.wav (~48 s, estéreo 44,1 kHz)
 *
 * Empacota scripts/audio/preview-entry.ts com esbuild, abre num Chromium já instalado
 * (sem `playwright install`) e renderiza tudo com OfflineAudioContext: música do sorteio com ducking,
 * bolas narradas, Linha, Linha dupla, bola extra grátis e Bingo.
 *
 * ATENÇÃO: não há clipes de voz reais. Cada fala é um "beep falado" sintético (tom curto) que marca
 * onde a voz entra e aciona o ducking de verdade. Só música, efeitos e ducking são avaliáveis aqui;
 * a voz real entra depois (scripts/audio/generate.ts).
 *
 * Chromium: usa CHROMIUM_PATH, senão /opt/pw-browsers/chromium.
 */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = join(ROOT, 'docs/qa/audio-preview.wav');

const exe = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p) => p && existsSync(p));
if (!exe) {
  console.error('Chromium não encontrado. Defina CHROMIUM_PATH=/caminho/do/chrome (ou instale em /opt/pw-browsers/chromium).');
  process.exit(1);
}

const bundle = await build({
  entryPoints: [join(ROOT, 'scripts/audio/preview-entry.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  logLevel: 'error',
});
const code = bundle.outputFiles[0].text;

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => (m.type() === 'error' ? console.error('[página]', m.text()) : null));
  page.on('pageerror', (e) => console.error('[página] erro:', e.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: code });
  console.log('Renderizando (offline, pode levar alguns segundos)...');
  const res = await page.evaluate(() => (window as any).__render());
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, Buffer.from(res.wavBase64, 'base64'));
  console.log(`\nOK  ${OUT}  (pico ${(20 * Math.log10(res.peak || 1e-9)).toFixed(1)} dBFS)`);
  console.log('\nLinha do tempo (s):');
  for (const e of res.timeline) console.log(`  ${String(e.t.toFixed(1)).padStart(5)}  ${e.what}`);
  console.log('\nNível por segundo (dBFS RMS, canal L):\n  ' + res.rmsBySecond.join(' '));
  console.log('\nLembrete: as falas são beeps de marcação; a voz real ainda não foi gerada.');
} finally {
  await browser.close();
}
