import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Troca __BUILD_ID__ em dist/sw.js por um hash dos assets: cada build gera um SW novo (cache versionado).
function swBuildId(): Plugin {
  return {
    name: 'sw-build-id',
    apply: 'build',
    closeBundle() {
      const names = readdirSync('dist/assets').sort().join('|');
      const id = createHash('sha1').update(names).digest('hex').slice(0, 8);
      const p = 'dist/sw.js';
      writeFileSync(p, readFileSync(p, 'utf8').replace('__BUILD_ID__', id));
    },
  };
}

export default defineConfig({
  plugins: [swBuildId()],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    rollupOptions: { input: 'index.html' },
  },
});
