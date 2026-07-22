import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { chromiumStabilizationArgs } from '../testConstants';

const root = path.resolve(__dirname, '../..');

function getWorktreePort(defaultPort = 5174): number {
  if (process.env.SVSCH_VISUAL_PORT) return Number(process.env.SVSCH_VISUAL_PORT);
  let hash = 0;
  for (let i = 0; i < root.length; i++) {
    hash = (hash * 31 + root.charCodeAt(i)) & 0x7fffffff;
  }
  return defaultPort + (hash % 100);
}

const visualPort = getWorktreePort();
const visualBaseUrl = `http://127.0.0.1:${visualPort}`;

const reporters: any[] = [['list']];
if (process.env.SVSCH_TEST_STATUS_FILE) {
  reporters.push([path.resolve(root, 'scripts/playwright-progress-reporter.js')]);
}

export default defineConfig({
  globalSetup: path.resolve(__dirname, 'globalSetup.ts'),
  globalTeardown: path.resolve(__dirname, '../globalTeardown.ts'),
  testDir: __dirname,
  outputDir: path.resolve(__dirname, '../../test-results/syntax-book'),
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  reporter: reporters,
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
