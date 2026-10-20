import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    rollupOptions: { input: 'index.html' },
  },
});
