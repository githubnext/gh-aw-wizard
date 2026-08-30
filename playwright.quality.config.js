import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/quality',
  timeout: 5 * 60 * 1000,
  workers: 1,
  webServer: {
    // The evaluator imports the browser runner directly so it can score the
    // model's raw answer without the production UI's keyword fallback.
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: false
  }
});
