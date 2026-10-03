import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localServerlessChromium = '/tmp/chromium';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (existsSync(localServerlessChromium) ? localServerlessChromium : undefined);

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    headless: true,
    colorScheme: 'dark',
    launchOptions: {
      executablePath,
      args: executablePath ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx next start -H 0.0.0.0 -p 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
