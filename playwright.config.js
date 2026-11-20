import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.js', workers: 1, retries: 0, timeout: 30000,
  use: { baseURL: 'http://localhost:4173', channel: 'msedge', headless: true,
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    viewport: { width: 1440, height: 1050 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://localhost:4173', reuseExistingServer: true },
});
