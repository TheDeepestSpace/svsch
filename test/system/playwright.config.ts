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
      // Full VSCode window includes the sidebar and status bar, which can
      // have a handful of anti-aliasing pixels differ across VS Code
      // versions/electron builds. 2500 was previously found to be high
      // enough to silently mask a missing toolbar label (2195px diff) — a
      // real regression that shipped without any snapshot update.
      maxDiffPixels: 500,
    },
  },
  use: {
    extensionDevelopmentPath: root,
    // VSCode workspace: ./test/ already has .vscode/settings.json configuring
    // svsch.projectFolder = fixtures and suppressing noisy popups.
    baseDir: path.join(root, 'test'),
    deviceScaleFactor: 1,
    // Pin to Electron 30 era. VSCode 1.121 uses Electron 35+ which
    // drops --remote-debugging-port=0 support that Playwright 1.59 requires.
    vscodeVersion,
    vscodeTrace: 'retain-on-failure',
  },
});
