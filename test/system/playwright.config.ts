import { defineConfig } from '@playwright/test';
import type { VSCodeWorkerOptions, VSCodeTestOptions } from 'vscode-test-playwright';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const vscodeVersion = process.env.VSCODE_VERSION || '1.91.0';

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: __dirname,
  snapshotDir: path.join(__dirname, '__screenshots__', vscodeVersion),
  workers: 1,
  timeout: 240_000,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(root, 'playwright-report/system') }],
  ],
  expect: {
    toHaveScreenshot: {
      // Full VSCode window includes the sidebar and status bar which can
      // have minor rendering differences — use a generous pixel budget.
      maxDiffPixels: 300,
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
