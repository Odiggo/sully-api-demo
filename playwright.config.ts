import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalTimeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    contextOptions: {
      reducedMotion: 'reduce',
    },
  },
  webServer: {
    command: 'pnpm start',
    url: 'http://127.0.0.1:3100/health',
    env: {
      PORT: '3100',
      SULLY_DEMO_OPEN_BROWSER: 'false',
      SULLY_API_URL: 'https://api-testing.sully.ai',
      SULLY_API_KEY: 'test-key',
      SULLY_ACCOUNT_ID: 'test-account',
    },
    reuseExistingServer: false,
  },
});
