import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { chromiumStabilizationArgs } from '../testConstants';

const visualPort = Number(process.env.SVSCH_VISUAL_PORT ?? 5174);
const visualBaseUrl = `http://127.0.0.1:${visualPort}`;

export default defineConfig({
  testDir: __dirname,
  outputDir: path.resolve(__dirname, '../../test-results/syntax-book'),
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: visualBaseUrl,
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    viewport: { width: 1400, height: 1000 }
  },
  webServer: {
    command: `npm run visual:serve -- --port ${visualPort}`,
    url: visualBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: chromiumStabilizationArgs
        }
      }
    }
  ]
});
