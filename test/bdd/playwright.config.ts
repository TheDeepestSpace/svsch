import { defineConfig } from '@playwright/test';
import type { VSCodeWorkerOptions, VSCodeTestOptions } from 'vscode-test-playwright';
import { defineBddConfig } from 'playwright-bdd';
import path from 'path';
import os from 'os';

const root = path.resolve(__dirname, '../..');
const vscodeVersion = process.env.VSCODE_VERSION || '1.91.0';
const generatedDir = path.join(os.tmpdir(), `svsch-bdd-generated-${path.basename(root)}`);
const reportDir = path.join(os.tmpdir(), `svsch-bdd-report-${path.basename(root)}`);

const outputDir = defineBddConfig({
  features: path.join(root, 'test/features/**/*.feature'),
  featuresRoot: path.join(root, 'test'),
  steps: [
    path.join(root, 'test/steps/fixtures.ts'),
    path.join(root, 'test/steps/*.steps.ts'),
  ],
  outputDir: generatedDir,
  tags: 'not @skip',
  disableWarnings: { importTestFrom: true },
});

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: outputDir,
  // Keep test artifacts on overlayfs (/tmp) to avoid v9fs ENOSPC issues when
  // vscode-test-playwright copies VS Code logs at teardown.
  outputDir: '/tmp/bdd-playwright-results',
  workers: 1,
  timeout: 120_000,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: reportDir }],
  ],
  snapshotDir: path.join(root, 'test/features/__screenshots__', vscodeVersion),
  expect: {
    toHaveScreenshot: { maxDiffPixels: 300 },
  },
  use: {
    extensionDevelopmentPath: root,
    // Use a minimal workspace with no .sv files at startup; scenarios write
    // their own files before opening the diagram through the extension.
    baseDir: path.join(root, 'test/bdd-workspace'),
    deviceScaleFactor: 1,
    vscodeVersion,
    vscodeTrace: 'retain-on-failure',
  },
});
