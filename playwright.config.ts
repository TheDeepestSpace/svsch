import { defineConfig, devices } from '@playwright/test';
import { chromiumStabilizationArgs } from './test/testConstants';
import path from 'path';

let reporters: any[] = process.env.CI
  ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
  : [['list']];

if (process.env.SVSCH_TEST_STATUS_FILE) {
  reporters.push([path.resolve(__dirname, 'scripts/playwright-progress-reporter.js')]);
}

function getWorktreePort(defaultPort = 5174): number {
  if (process.env.SVSCH_VISUAL_PORT) return Number(process.env.SVSCH_VISUAL_PORT);
  let hash = 0;
  const dir = __dirname;
  for (let i = 0; i < dir.length; i++) {
    hash = (hash * 31 + dir.charCodeAt(i)) & 0x7fffffff;
  }
  return defaultPort + (hash % 100);
}

const visualPort = getWorktreePort();
const visualBaseUrl = `http://127.0.0.1:${visualPort}`;

export default defineConfig({
  testDir: './test/visual',
  outputDir: './test-results/visual',
  snapshotDir: './test/visual/__screenshots__',
  fullyParallel: false,
  timeout: 90_000,
  reporter: reporters,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 50
    }
  },
  use: {
    baseURL: visualBaseUrl,
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    screenshot: {
      scale: 'css'
    },
    trace: 'retain-on-failure',
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
