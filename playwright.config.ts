import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:4173', launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  webServer: { command: 'npm run build && npx vite preview --port 4173', port: 4173, reuseExistingServer: true },
});
