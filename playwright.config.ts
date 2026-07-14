import { defineConfig } from '@playwright/test';
import { z } from 'zod';

const e2ePort = z
  .string()
  .regex(/^[1-9]\d{0,4}$/)
  .transform(Number)
  .refine((port) => port <= 65_535)
  .parse(process.env.E2E_PORT ?? '3100');
const baseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './e2e',
  globalTimeout: 120_000,
  use: {
    baseURL,
    contextOptions: {
      reducedMotion: 'reduce',
    },
  },
  webServer: {
    command: 'pnpm start',
    url: `${baseURL}/health`,
    env: {
      PORT: String(e2ePort),
      SULLY_DEMO_OPEN_BROWSER: 'false',
      SULLY_API_URL: 'https://api-testing.sully.ai',
      SULLY_API_KEY: 'test-key',
      SULLY_ACCOUNT_ID: 'test-account',
    },
    reuseExistingServer: false,
  },
});
