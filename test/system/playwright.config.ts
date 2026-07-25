import { defineConfig } from '@playwright/test';
import type { VSCodeWorkerOptions, VSCodeTestOptions } from 'vscode-test-playwright';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const vscodeVersion = process.env.VSCODE_VERSION || '1.91.0';

const reporters: any[] = [
  ['list'],
  ['html', { open: 'never', outputFolder: path.join(root, 'playwright-report/system') }],
];

if (process.env.SVSCH_TEST_STATUS_FILE) {
  reporters.push([path.resolve(root, 'scripts/playwright-progress-reporter.js')]);
}

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  globalSetup: path.resolve(__dirname, 'globalSetup.ts'),
  globalTeardown: path.resolve(__dirname, '../globalTeardown.ts'),
  testDir: __dirname,
  snapshotDir: path.join(__dirname, '__screenshots__', vscodeVersion),
  workers: 1,
  timeout: 240_000,
  reporter: reporters,
  expect: {
    toHaveScreenshot: {
      // Full VSCode window includes the sidebar and status bar which can
      // have minor rendering differences — use a generous pixel budget.
      maxDiffPixels: 2500,
    },
  },
  use: {
    extensionDevelopmentPath: root,
    // VSCode workspace: ./test/ already has .vscode/settings.json configuring
    // svsch.projectFolder = visual/fixtures and suppressing noisy popups.
    baseDir: path.join(root, 'test'),
    deviceScaleFactor: 1,
    // Pin to Electron 30 era. VSCode 1.121 uses Electron 35+ which
    // drops --remote-debugging-port=0 support that Playwright 1.59 requires.
    vscodeVersion,
    vscodeTrace: 'retain-on-failure',
  },
});
