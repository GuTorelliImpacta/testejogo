import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Piso de compatibilidade: tablet Android 5/6 com Chrome/WebView ~60 (SPEC-v3 3.5.2). Detalhes em docs/qa/compat-fase3.md.
// - JS: esbuild baixa a sintaxe (?., ??, catch sem parâmetro, async generators...) para o que o Chrome 60 entende.
// - CSS: cores #rrggbbaa viram rgba(), etc. (cssTarget).
// - O Chrome 60 NÃO executa <script type="module"> (só a partir do 61): o app sai como script clássico (IIFE) com `defer`.
const FLOOR = 'chrome60';

/** Troca <script type="module" crossorigin src> por <script defer src> (bundle IIFE, sem imports). */
function classicScript(): Plugin {
  return {
    name: 'classic-script',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>');
      },
    },
  };
}

/** esbuild só converte #RRGGBBAA em algumas propriedades; o Chrome < 62 invalidaria o resto (border, box-shadow...). */
function hex8ToRgba(): Plugin {
  const conv = (css: string) =>
    css.replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{4})(?![0-9a-zA-Z_-])/g, (_m, h: string) => {
      const x = h.length === 4 ? h.split('').map((c) => c + c).join('') : h;
      const n = (i: number) => parseInt(x.slice(i, i + 2), 16);
      const a = n(6) / 255;
      const as = a >= 1 ? '' : (Math.round(a * 1000) / 1000).toString().replace(/^0\./, '.');
      return as ? `rgba(${n(0)},${n(2)},${n(4)},${as})` : `rgb(${n(0)},${n(2)},${n(4)})`;
    });
  return {
    name: 'hex8-to-rgba',
    apply: 'build',
    enforce: 'post',
    generateBundle(_o, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type === 'asset' && f.fileName.endsWith('.css') && typeof f.source === 'string') f.source = conv(f.source);
      }
    },
  };
}

// Troca __BUILD_ID__ em dist/sw.js por um hash do build (assets com hash + HTML + manifest):
// cada build gera um SW novo (cache versionado) e o `activate` apaga os caches antigos.
function swBuildId(): Plugin {
  return {
    name: 'sw-build-id',
    apply: 'build',
    closeBundle() {
      const names = readdirSync('dist/assets').sort().join('|');
      const hash = createHash('sha1');
      hash.update(names);
      for (const f of ['dist/index.html', 'dist/manifest.webmanifest']) {
        try {
          hash.update(readFileSync(f));
        } catch {
          /* arquivo ausente: ignora */
        }
      }
      const id = hash.digest('hex').slice(0, 8);
      // versão do pacote de voz: hash dos manifests de voz (os clipes só mudam junto com eles)
      const vh = createHash('sha1');
      for (const d of ['voice', 'voice-custom']) {
        try {
          vh.update(readFileSync(`dist/audio/${d}/manifest.json`));
        } catch {
          /* sem pacote */
        }
      }
      const p = 'dist/sw.js';
      writeFileSync(p, readFileSync(p, 'utf8').replace(/__BUILD_ID__/g, id).replace(/__VOICE_ID__/g, vh.digest('hex').slice(0, 8)));
    },
  };
}

export default defineConfig({
  plugins: [classicScript(), hex8ToRgba(), swBuildId()],
  esbuild: { target: FLOOR },
  build: {
    target: FLOOR,
    cssTarget: FLOOR,
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    modulePreload: false,
    rollupOptions: {
      input: 'index.html',
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});
