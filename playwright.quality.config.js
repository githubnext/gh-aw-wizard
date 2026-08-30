import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/quality',
  timeout: 45 * 60 * 1000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--use-angle=swiftshader'
      ]
    }
  },
  webServer: {
    // The evaluator imports the browser runner directly so it can score the
    // model's raw answer without the production UI's keyword fallback.
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: false
  }
});
