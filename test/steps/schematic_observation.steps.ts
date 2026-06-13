import { Given, When, Then, BddWorld } from './fixtures';
import { expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Natural-flow steps: file creation, VS Code folder configuration, and
// command palette interactions.  These steps let the extension build and
// display the diagram through its normal pipeline rather than via injection.
// ---------------------------------------------------------------------------

Given('I have a file {string}:', async function (this: BddWorld, filePath: string, docString: string) {
  const fullPath = path.join(BddWorld.BDD_WORKSPACE, filePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, docString);
  this._bddWorkspaceFiles.push(fullPath);
  this.files = this.files.filter((source: any) => source.file !== filePath);
  this.files.push({ file: filePath, text: docString });
  this.lastCode ??= docString;
});

When('I open VS Code to {string}', async function (this: BddWorld, folder: string) {
  await this.evaluateInVSCode((_vscode, f) => {
    return (_vscode as any).workspace
      .getConfiguration('svsch')
      .update('projectFolder', f, (_vscode as any).ConfigurationTarget.Workspace);
  }, folder);
});

When('I open the command palette with Ctrl+Shift+P', async function (this: BddWorld) {
  await this.workbox.keyboard.press('Control+Shift+P');
  await this.workbox.waitForSelector('.quick-input-widget', { timeout: 5_000 });
});

When('I type {string}', async function (this: BddWorld, text: string) {
  await this.workbox.keyboard.type(text);
});

When('I press Enter', async function (this: BddWorld) {
  await this.workbox.keyboard.press('Enter');
});

Then('the SVSCH diagram panel opens', async function (this: BddWorld) {
  await this.workbox.waitForSelector(
    '.tab[aria-label*="SVSCH"], .tab[title*="SVSCH"]',
    { timeout: 30_000 }
  );
  // Wait for the extension's graph build + webview render (Surelog may be slow on first run)
  await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 90_000 });
  await this.takeScreenshot('SVSCH diagram panel open');
});

Then('the {string} module is selected in the module dropdown', async function (this: BddWorld, moduleName: string) {
  await expect(
    this.webviewPage.locator('select[aria-label="Module"]')
  ).toHaveValue(moduleName, { timeout: 10_000 });
  await this.takeScreenshot(`Module ${moduleName} selected in dropdown`);
});

// ---------------------------------------------------------------------------
// Composite step: write files + open diagram via command palette in one shot.
// ---------------------------------------------------------------------------

When('I open the {string} module in SVSCH', async function (this: BddWorld, moduleName: string) {
  // Cached-graph scenarios still open the real SVSCH panel, then hydrate it
  // with the graph prepared by their Given step.
  let folder = this.lastGraph ? './no-sv-files-here' : '.';
  if (!this.lastGraph && this._bddWorkspaceFiles.length > 0) {
    const relDir = path.relative(BddWorld.BDD_WORKSPACE, path.dirname(this._bddWorkspaceFiles[0]));
    folder = relDir || '.';
  }

  await this.evaluateInVSCode((_vscode, f) => {
    return (_vscode as any).workspace
      .getConfiguration('svsch')
      .update('projectFolder', f, (_vscode as any).ConfigurationTarget.Workspace);
  }, folder);

  if (this.lastGraph?.modules?.[moduleName]) {
    await this.openCapturedDiagramPanel();
    await this.selectModule(moduleName);
    return;
  }

  await this.workbox.keyboard.press('Control+Shift+P');
  await this.workbox.waitForSelector('.quick-input-widget', { timeout: 5_000 });
  await this.workbox.keyboard.type('SVSCH: Open Diagram');
  await this.workbox.keyboard.press('Enter');

  await this.workbox.waitForSelector(
    '.tab[aria-label*="SVSCH"], .tab[title*="SVSCH"]',
    { timeout: 30_000 }
  );

  // Wait for any in-progress rebuild to settle before asserting on nodes
  await this.webviewPage.locator('div.busy-indicator[role="status"]')
    .waitFor({ state: 'hidden', timeout: 90_000 })
    .catch(() => {});

  await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 90_000 });

  await expect(
    this.webviewPage.locator('select[aria-label="Module"]')
  ).toHaveValue(moduleName, { timeout: 10_000 });

  await this.takeScreenshot(`Viewing module ${moduleName}`);
});
