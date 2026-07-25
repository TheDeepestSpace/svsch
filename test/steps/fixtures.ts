import { test as vsCodeTest } from 'vscode-test-playwright';
import { test as bddTest, createBdd } from 'playwright-bdd';
import { mergeTests } from '@playwright/test';
import type { Page, FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { buildDesignGraph } from '../../src/parser/backend';
import {
  buildViewModel,
  mergeNodePositions,
} from '../../src/layout/mergeLayout';
import { compareGraphState } from '../graphRegression';

type ScreenshotCompareBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// ---------------------------------------------------------------------------
// BddWorld — mutable per-scenario state, analogous to old CustomWorld
// ---------------------------------------------------------------------------

export class BddWorld {
  // Set in Before hook from Playwright fixtures
  workbox!: Page;
  webviewPage!: FrameLocator;
  evaluateInVSCode!: <R, Arg = void>(
    fn: (vscode: any, arg: Arg) => R,
    arg?: Arg
  ) => Promise<R>;
  testInfo!: import('@playwright/test').TestInfo;

  // Scenario metadata
  scenarioName?: string;
  scenarioId?: string;
  scenarioExampleIndex?: number;
  isScenarioOutline = false;
  stepCounter = 0;
  updateSnapshots = false;
  nextCliSnapshotStepCounter?: number;

  // Diagram state
  layout: any = { version: 1, modules: {} };
  lastGraph?: any;
  lastCode?: string;
  lastViewModel?: any;

  // File state
  files: any[] = [];
  workspaceDir?: string;
  _bddWorkspaceFiles: string[] = [];
  workspaceDirStateBefore?: string[];

  // CLI output
  lastCliSvg?: string;
  lastCliSvgPath?: string;
  lastCliPng?: Buffer;
  lastCliPngPath?: string;
  lastCliStdout?: string;
  lastCliStderr?: string;

  // Remembered positions/routes for assertions
  notedPositions: Map<string, { x: number; y: number }> = new Map();
  notedRegionBounds: Map<string, { x: number; y: number; width: number; height: number }> = new Map();
  notedGenerateRegionMoves: Map<string, {
    nodePositions: Map<string, { x: number; y: number }>;
    outsideNodePositions: Map<string, { x: number; y: number }>;
    expectedDelta: { x: number; y: number };
  }> = new Map();
  pendingNodeDrag?: {
    nodeId: string;
    label: string;
    moduleName: string;
  };
  // Where a node ended up after the user dragged it (post-move), so reload
  // scenarios can assert the position was preserved.
  movedToPositions: Map<string, { x: number; y: number }> = new Map();
  notedRoutes: Map<string, string> = new Map();

  // -------------------------------------------------------------------------
  // Screenshot / snapshot helpers
  // -------------------------------------------------------------------------

  async takeScreenshot(label: string): Promise<Buffer | null> {
    await this._settleWorkbenchForScreenshot();
    const screenshot = await this.workbox.screenshot();
    await this._attachBuffer(screenshot, 'image/png');

    if (this.scenarioName) {
      this.stepCounter += 1;
      const safeScenarioName = this.scenarioName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const scenarioId = this.isScenarioOutline ? `-${this.scenarioExampleIndex}` : '';
      const safeLabel = label.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const snapshotName = `${safeScenarioName}${scenarioId}--${this.stepCounter.toString().padStart(2, '0')}--${safeLabel}`;
      const graphState = await this.webviewPage.locator('html').evaluate(() => {
        const rf = (window as any).reactFlowInstance;
        if (!rf) return { nodes: [], edges: [] };
        const nodeElems = Array.from(document.querySelectorAll('.react-flow__node'));
        const nodeMap = new Map<string, Element>();
        for (const el of nodeElems) {
          const id = el.getAttribute('data-id');
          if (id) nodeMap.set(id, el);
        }
        const nodes = rf.getNodes().map((n: any) => {
          const nodeElement = nodeMap.get(n.id);
          const warningNote = nodeElement?.querySelector('.node-warning')?.getAttribute('aria-label')
            ?? n.data?.node?.warningNote
            ?? undefined;
          return {
            id: n.id, type: n.type,
            position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
            width: Math.round(n.measured?.width ?? n.width ?? 0),
            height: Math.round(n.measured?.height ?? n.height ?? 0),
            data: n.data ? {
              label: n.data.label,
              kind: n.data.node?.kind,
              ports: n.data.node?.ports?.map((p: any) => ({
                id: p.id,
                name: p.name,
                side: p.side,
                direction: p.direction,
                metadata: p.metadata,
              })),
            } : undefined,
            active: nodeElement?.classList.contains('generate-node-active') || undefined,
            inactive: nodeElement?.classList.contains('generate-node-inactive') || undefined,
            invalid: nodeElement?.classList.contains('svsch-node-invalid') || undefined,
            warningNote,
          };
        });
        const edgeElems = Array.from(document.querySelectorAll('.react-flow__edge'));
        const edgeMap = new Map<string, Element>();
        for (const el of edgeElems) {
          const id = el.getAttribute('data-id');
          if (id) edgeMap.set(id, el);
        }
        const edges = rf.getEdges().map((e: any) => {
          const edgeEl = edgeMap.get(e.id);
          const el = edgeEl?.querySelector('path.svsch-edge, path.react-flow__edge-path');
          return { id: e.id, source: e.source, target: e.target,
            sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
            path: el?.getAttribute('d') ?? '',
            active: edgeEl?.classList.contains('generate-edge-active') || undefined,
            inactive: edgeEl?.classList.contains('generate-edge-inactive') || undefined };
        });
        const regions = Array.from(document.querySelectorAll('.generate-region')).map((region: Element) => {
          const element = region as HTMLElement;
          const title = element.querySelector('.generate-region-title')?.textContent?.trim() ?? '';
          const warningNote = element.dataset.warningNote
            ?? element.querySelector('.generate-region-warning')?.getAttribute('aria-label')
            ?? element.querySelector('.generate-region-note')?.textContent?.trim()
            ?? undefined;
          return {
            id: element.dataset.regionId ?? '',
            kind: element.dataset.regionKind,
            label: title,
            bounds: {
              x: Math.round(Number.parseFloat(element.style.left || '0')),
              y: Math.round(Number.parseFloat(element.style.top || '0')),
              width: Math.round(Number.parseFloat(element.style.width || '0')),
              height: Math.round(Number.parseFloat(element.style.height || '0')),
            },
            active: element.classList.contains('generate-region-active') || undefined,
            inactive: element.classList.contains('generate-region-inactive') || undefined,
            invalid: element.classList.contains('generate-region-invalid') || undefined,
            warningNote,
          };
        }).filter(region => region.id);
        nodes.sort((a: any, b: any) => a.id.localeCompare(b.id));
        edges.sort((a: any, b: any) => a.id.localeCompare(b.id));
        regions.sort((a: any, b: any) => a.id.localeCompare(b.id));
        return regions.length > 0 ? { nodes, edges, regions } : { nodes, edges };
      }).catch(() => ({ nodes: [], edges: [] }));
      if (!process.env.SKIP_SNAPSHOTS) {
        await this._compareSnapshots(
          screenshot,
          graphState,
          snapshotName,
          await this._webviewCompareBox()
        );
      }
    }
    return screenshot;
  }

  private async _webviewCompareBox(): Promise<ScreenshotCompareBox | null> {
    const box = await this.workbox.locator('iframe.webview').first().boundingBox().catch(() => null);
    if (!box || box.width < 10 || box.height < 10) return null;
    return {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  }

  private async _attachBuffer(buf: Buffer, contentType: string): Promise<void> {
    if (this.testInfo) {
      const fs = require('fs');
      const path = require('path');
      const screenshotsDir = path.join(process.cwd(), 'test-results', 'bdd', 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      const filename = `screenshot-${Date.now()}-${Math.floor(Math.random() * 10000)}.png`;
      const filepath = path.join(screenshotsDir, filename);
      fs.writeFileSync(filepath, buf);
      await this.testInfo.attach('diagram-screenshot', { path: filepath, contentType });
    }
  }

  private async _compareSnapshots(
    actualBuffer: Buffer,
    actualGraph: any,
    snapshotName: string,
    compareBox: ScreenshotCompareBox | null = null
  ): Promise<void> {
    const snapshotsDir = path.join(process.cwd(), 'test', 'features', 'snapshots');
    const resultsDir = path.join(process.cwd(), 'test-results', 'bdd', 'visual-diffs');
    if (!fs.existsSync(snapshotsDir)) fs.mkdirSync(snapshotsDir, { recursive: true });
    const updateSnapshots = this.updateSnapshots || !!process.env.UPDATE_SNAPSHOTS;

    compareGraphState(
      actualGraph,
      snapshotName,
      snapshotsDir,
      resultsDir,
      updateSnapshots,
      () => {}
    );

    const snapshotPath = path.join(snapshotsDir, `${snapshotName}.png`);
    if (!fs.existsSync(snapshotPath) || updateSnapshots) {
      fs.writeFileSync(snapshotPath, actualBuffer);
      return;
    }

    const expectedImage = PNG.sync.read(fs.readFileSync(snapshotPath));
    const actualImage = PNG.sync.read(actualBuffer);
    const expectedForCompare = compareBox ? cropPng(expectedImage, compareBox) : expectedImage;
    const actualForCompare = compareBox ? cropPng(actualImage, compareBox) : actualImage;
    const { width, height } = expectedForCompare;
    if (width !== actualForCompare.width || height !== actualForCompare.height) {
      if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(path.join(resultsDir, `${snapshotName}-expected.png`), fs.readFileSync(snapshotPath));
      fs.writeFileSync(path.join(resultsDir, `${snapshotName}-actual.png`), actualBuffer);
      throw new Error(
        `Snapshot size mismatch for "${snapshotName}": expected ${width}x${height}, ` +
        `got ${actualForCompare.width}x${actualForCompare.height}.`
      );
    }
    const diff = new PNG({ width, height });
    const numDiffPixels = pixelmatch(
      expectedForCompare.data,
      actualForCompare.data,
      diff.data,
      width,
      height,
      { threshold: 0.1 }
    );
    if (numDiffPixels > 50) {
      if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(path.join(resultsDir, `${snapshotName}-expected.png`), fs.readFileSync(snapshotPath));
      fs.writeFileSync(path.join(resultsDir, `${snapshotName}-actual.png`), actualBuffer);
      fs.writeFileSync(path.join(resultsDir, `${snapshotName}-diff.png`), PNG.sync.write(diff));
      throw new Error(`Snapshot mismatch for "${snapshotName}": ${numDiffPixels} pixels differ.`);
    }
  }

  // -------------------------------------------------------------------------
  // Graph / workspace helpers
  // -------------------------------------------------------------------------

  // Root of the VSCode workspace shown in the Explorer during BDD tests.
  static readonly BDD_WORKSPACE = path.resolve(__dirname, '../../test/bdd-workspace');

  async _ensureGraphBuilt(): Promise<void> {
    if (this.lastGraph) return;
    if (this.files.length === 0) return;

    const workspaceRoot = BddWorld.BDD_WORKSPACE;
    this.workspaceDir = workspaceRoot;

    const surelogPath = process.env.SURELOG_PATH || path.resolve(process.cwd(), 'dist/surelog/bin/surelog');
    const backendPath = process.env.BACKEND_PATH || path.resolve(process.cwd(), 'dist/svsch_backend');

    this.lastGraph = await buildDesignGraph({
      workspaceRoot,
      projectFolder: '.',
      backend: 'uhdm',
      veriblePath: 'verible-verilog-syntax',
      surelogPath,
      backendPath,
      includeExternalDiagnostics: false,
    });
  }

  async selectModule(
    moduleName: string,
    screenshotLabel: string | false = `Viewing module ${moduleName}`
  ): Promise<void> {
    await this._ensureGraphBuilt();
    if (this.lastGraph) {
      const viewModel = await buildViewModel(this.lastGraph, moduleName, this.layout);
      this.lastViewModel = viewModel;
      this.layout = mergeNodePositions(this.layout, moduleName, viewModel.nodes);
    }
    await this._revealPanel();
    const moduleSelect = this.webviewPage.locator('select[aria-label="Module"]');
    await moduleSelect.waitFor({ timeout: 15_000 });
    const currentModule = await moduleSelect.inputValue().catch(() => undefined);
    if (currentModule !== moduleName) {
      await moduleSelect.selectOption(moduleName);
    }
    await expect(moduleSelect).toHaveValue(moduleName, { timeout: 15_000 });
    await this._waitForRenderedModule(moduleName, 30_000);
    await this.workbox.waitForTimeout(500);
    if (screenshotLabel) await this.takeScreenshot(screenshotLabel);
  }

  // Snapshot the current position of every port node into notedPositions. Called
  // when the diagram opens (to capture original positions) and before reroute
  // actions (to capture the pre-action baseline), so scenarios don't need
  // explicit "I note the position" steps.
  async recordPortPositions(): Promise<void> {
    const ports = await this.webviewPage.locator('html').evaluate(() => {
      const rf = (window as any).reactFlowInstance;
      if (!rf) return [];
      return rf.getNodes()
        .filter((n: any) => n.data?.node?.kind === 'port')
        .map((n: any) => ({ label: n.data?.node?.label ?? n.data?.node?.name, position: n.position }));
    });
    for (const port of ports) {
      if (port.label) this.notedPositions.set(port.label, port.position);
    }
  }

  async _waitForDiagramRebuild(): Promise<void> {
    await this.evaluateInVSCode(vscode => {
      void (vscode as any).commands.executeCommand('svsch.rebuildDiagram');
    }).catch(() => {});
    // Give VS Code's file watcher time to detect the change and start rebuilding.
    await this.workbox.waitForTimeout(500);
    // Wait for the busy indicator to appear then disappear (extension is rebuilding).
    await this.webviewPage.locator('div.busy-indicator[role="status"]')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {});
    await this.webviewPage.locator('div.busy-indicator[role="status"]')
      .waitFor({ state: 'hidden', timeout: 90_000 })
      .catch(() => {});
    await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });
    await this.workbox.waitForTimeout(500);
  }

  async _waitForRenderedModule(moduleName: string, timeout = 30_000): Promise<void> {
    await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout });
    await expect.poll(async () => {
      return this.webviewPage.locator('html').evaluate((_el, expectedModule) => {
        try {
          const rf = (window as any).reactFlowInstance;
          if (!rf || typeof rf.getNodes !== 'function' || typeof rf.getEdges !== 'function') return false;

          const nodes = rf.getNodes();
          if (!nodes || nodes.length === 0) return false;
          if (!nodes.every((node: any) => node.data?.moduleName === expectedModule)) {
            return false;
          }

          const nodeElems = document.querySelectorAll('.react-flow__node');
          if (nodeElems.length === 0) return false;

          const edges = rf.getEdges();
          if (!edges || edges.length === 0) return true;

          const edgeElems = Array.from(document.querySelectorAll('.react-flow__edge'));
          if (edgeElems.length === 0) return false;

          const edgeMap = new Map<string, Element>();
          for (const el of edgeElems) {
            const id = el.getAttribute('data-id');
            if (id) edgeMap.set(id, el);
          }

          let validCount = 0;
          for (const edge of edges) {
            if (!edge || !edge.id) continue;
            const el = edgeMap.get(edge.id);
            if (el) {
              const pathEl = el.querySelector('path[d], path');
              if (pathEl && pathEl.getAttribute('d')) {
                validCount++;
              }
            }
          }

          return validCount === edges.length || (validCount > 0 && edgeElems.length > 0);
        } catch {
          return false;
        }
      }, moduleName).catch(() => false);
    }, { timeout }).toBe(true);
  }

  async _settleWorkbenchForScreenshot(): Promise<void> {
    const toasts = await this.workbox.locator('.notification-toast', { hasText: 'SVSCH' }).all().catch(() => []);
    for (const toast of toasts) {
      await toast.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    }

    for (const btn of await this.workbox.locator('.notification-toast button', { hasText: /Never|Don't show/i }).all()) {
      await btn.click().catch(() => {});
    }

    await refreshFilesExplorer(this.workbox, this.evaluateInVSCode);
  }

  async selectedEditorText(): Promise<string | null> {
    return this.evaluateInVSCode((vscode) => {
      const editor = (vscode as any).window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) return null;
      return editor.document.getText(editor.selection);
    });
  }

  // -------------------------------------------------------------------------
  // Internal: bring the SVSCH webview panel to the foreground
  // -------------------------------------------------------------------------

  async _revealPanel(): Promise<void> {
    // Click the SVSCH tab if visible, so VSCode loads/activates the iframe.
    const tab = this.workbox.locator('.tab[aria-label*="SVSCH"], .tab[title*="SVSCH"]').first();
    if (await tab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tab.click();
      await this.workbox.waitForTimeout(300);
    } else {
      // Tab gone — re-open via command
      await this.evaluateInVSCode(vscode => {
        void (vscode as any).commands.executeCommand('svsch.openDiagram');
      });
      await this.workbox.waitForSelector('.tab[aria-label*="SVSCH"], .tab[title*="SVSCH"]', { timeout: 15_000 });
      await this.workbox.waitForTimeout(300);
    }
  }

}

function cropPng(source: PNG, box: ScreenshotCompareBox): PNG {
  const x = Math.max(0, Math.min(source.width - 1, box.x));
  const y = Math.max(0, Math.min(source.height - 1, box.y));
  const width = Math.max(1, Math.min(source.width - x, box.width));
  const height = Math.max(1, Math.min(source.height - y, box.height));
  const cropped = new PNG({ width, height });

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    const sourceEnd = sourceStart + width * 4;
    const targetStart = row * width * 4;
    source.data.copy(cropped.data, targetStart, sourceStart, sourceEnd);
  }

  return cropped;
}

// ---------------------------------------------------------------------------
// Playwright test extended with BddWorld fixture
// ---------------------------------------------------------------------------

const mergedTest = mergeTests(bddTest, vsCodeTest);

export const test = mergedTest.extend<{ world: BddWorld }>({
  world: async ({ workbox, evaluateInVSCode, $testInfo }, use) => {
    const w = new BddWorld();
    w.workbox = workbox;
    w.webviewPage = workbox
      .frameLocator('iframe.webview')
      .frameLocator('iframe#active-frame');
    w.evaluateInVSCode = evaluateInVSCode as any;
    w.testInfo = $testInfo;
    await use(w);
  },
});

export const { Given, When, Then, Before, After } = createBdd(test, {
  worldFixture: 'world',
});

// ---------------------------------------------------------------------------
// Before / After hooks
// ---------------------------------------------------------------------------

const exampleCounters = new Map<string, number>();

function shouldUpdateSnapshots(testInfo: any): boolean {
  const mode = testInfo?.config?.updateSnapshots;
  return mode === 'all' || mode === 'changed' || !!process.env.UPDATE_SNAPSHOTS;
}

function scenarioMetadata(bddContext: any, testInfo: any): { name: string; isOutline: boolean; exampleIndex?: number } {
  const info = testInfo ?? bddContext?.testInfo;
  const title = info?.title ?? 'scenario';
  const outline = outlineMetadataFromFeature(bddContext);
  if (outline) return outline;

  const titlePath = typeof info?.titlePath === 'function' ? info.titlePath() : [];
  const parentTitle = Array.isArray(titlePath) ? titlePath[titlePath.length - 2] : undefined;
  const exampleMatch = /^Example #(\d+)$/.exec(title);
  if (exampleMatch && parentTitle && parentTitle !== title) {
    return { name: parentTitle, isOutline: true, exampleIndex: Number(exampleMatch[1]) };
  }

  const isOutline = info?.repeatEachIndex > 0
    || ((info?.annotations ?? []) as any[]).some((a: any) => a.type === 'outline');
  if (!isOutline) return { name: title, isOutline: false };

  const key = parentTitle ?? title;
  const count = (exampleCounters.get(key) ?? 0) + 1;
  exampleCounters.set(key, count);
  return { name: key, isOutline: true, exampleIndex: count };
}

function outlineMetadataFromFeature(bddContext: any): { name: string; isOutline: true; exampleIndex: number } | undefined {
  const featureUri = bddContext?.featureUri;
  const pickleLine = bddContext?.bddTestData?.pickleLine;
  if (!featureUri || !pickleLine) return undefined;

  const featurePath = resolveFeaturePath(bddContext, featureUri);
  if (!fs.existsSync(featurePath)) return undefined;

  const lines = fs.readFileSync(featurePath, 'utf8').split(/\r?\n/);
  let outlineLine = -1;
  let outlineName: string | undefined;
  for (let i = Math.min(pickleLine - 1, lines.length - 1); i >= 0; i -= 1) {
    const outlineMatch = /^\s*Scenario Outline:\s*(.+?)\s*$/.exec(lines[i]);
    if (outlineMatch) {
      outlineLine = i;
      outlineName = outlineMatch[1];
      break;
    }
    if (/^\s*Scenario:\s*/.test(lines[i])) break;
  }
  if (outlineLine < 0 || !outlineName) return undefined;

  let inExamples = false;
  let sawHeader = false;
  let exampleIndex = 0;
  for (let i = outlineLine + 1; i < Math.min(pickleLine, lines.length); i += 1) {
    if (/^\s*Examples:/.test(lines[i])) {
      inExamples = true;
      sawHeader = false;
      continue;
    }
    if (!inExamples || !/^\s*\|/.test(lines[i])) continue;
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    exampleIndex += 1;
  }

  return { name: outlineName, isOutline: true, exampleIndex: Math.max(1, exampleIndex) };
}

function resolveFeaturePath(bddContext: any, featureUri: string): string {
  if (path.isAbsolute(featureUri)) return featureUri;

  const candidates = [
    bddContext?.config?.configDir,
    process.cwd(),
    bddContext?.config?.featuresRoot,
    bddContext?.testInfo?.file ? path.dirname(bddContext.testInfo.file) : undefined,
  ]
    .filter((base): base is string => typeof base === 'string' && base.length > 0)
    .map((base) => path.resolve(base, featureUri));

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0] ?? featureUri;
}

Before(async function (this: BddWorld, { workbox, evaluateInVSCode, $bddContext, $testInfo }: any) {
  // Attach Playwright fixtures so helpers can use them
  this.workbox = workbox;
  if (!process.env.SKIP_SNAPSHOTS) {
    await this.workbox.setViewportSize({ width: 1400, height: 1000 });
  }
  this.webviewPage = workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe#active-frame');
  this.evaluateInVSCode = evaluateInVSCode as any;

  // Scenario metadata from playwright-bdd. Scenario outlines use Playwright
  // titles like "Example #1", so recover the Gherkin name for snapshot paths.
  const metadata = scenarioMetadata($bddContext, $testInfo);
  this.scenarioName = metadata.name;
  this.scenarioId = $testInfo.testId;
  this.isScenarioOutline = metadata.isOutline;
  this.scenarioExampleIndex = metadata.exampleIndex;
  this.updateSnapshots = shouldUpdateSnapshots($testInfo);

  // Remove any on-disk layout that accumulated from the previous scenario
  // (drag operations write to .svsch/layout.json; tests prepare per-scenario
  //  layouts so stale positions must not leak across scenarios)
  const layoutPath = path.join(BddWorld.BDD_WORKSPACE, '.svsch', 'layout.json');
  await fs.promises.rm(layoutPath, { force: true });
  await cleanBddWorkspace();

  // Reset per-scenario state
  this.layout = { version: 1, modules: {} };
  this.lastGraph = undefined;
  this.lastCode = undefined;
  this.lastViewModel = undefined;
  this.files = [];
  this.workspaceDirStateBefore = undefined;
  this.lastCliSvg = undefined;
  this.lastCliSvgPath = undefined;
  this.lastCliPng = undefined;
  this.lastCliPngPath = undefined;
  this.lastCliStdout = undefined;
  this.lastCliStderr = undefined;
  this.nextCliSnapshotStepCounter = undefined;
  this.stepCounter = 0;
  this.updateSnapshots = shouldUpdateSnapshots($testInfo);
  this.notedPositions = new Map();
  this.notedRegionBounds = new Map();
  this.notedGenerateRegionMoves = new Map();
  this.movedToPositions = new Map();
  this.notedRoutes = new Map();
  this._bddWorkspaceFiles = [];

  // Wait for VSCode workbench to be ready
  await workbox.waitForSelector('.monaco-workbench', { timeout: 30_000 });

  // Dismiss startup notifications
  for (const btn of await workbox.locator('.notification-toast button', { hasText: /Never|Don't show/i }).all()) {
    await btn.click().catch(() => {});
  }

  // Reset svsch.projectFolder to a non-existent directory so the extension's
  // file watcher never triggers a successful rebuild during setup.
  // Tests opening the diagram will override this in their open steps.
  await evaluateInVSCode(_vscode => {
    return (_vscode as any).workspace
      .getConfiguration('svsch')
      .update('projectFolder', './no-sv-files-here', (_vscode as any).ConfigurationTarget.Workspace);
  });

  await closeOpenSvschTabs(workbox, evaluateInVSCode);
  await cleanBddWorkspace();
  await refreshFilesExplorer(workbox, evaluateInVSCode);
});

After(async function (this: BddWorld, { workbox, evaluateInVSCode }: any) {
  await evaluateInVSCode((_vscode: any) => {
    return (_vscode as any).workspace
      .getConfiguration('svsch')
      .update('projectFolder', './no-sv-files-here', (_vscode as any).ConfigurationTarget.Workspace);
  }).catch(() => {});

  // Clean up .sv files written to bdd-workspace during this scenario
  for (const f of this._bddWorkspaceFiles) {
    await fs.promises.rm(f, { force: true });
  }
  this._bddWorkspaceFiles = [];

  // Remove on-disk layout so it doesn't persist into the next scenario
  const layoutPath = path.join(BddWorld.BDD_WORKSPACE, '.svsch', 'layout.json');
  await fs.promises.rm(layoutPath, { force: true });

  // Clean up workspace temp dir (used by CLI/openWorkspaceForEditing steps).
  // Never delete BDD_WORKSPACE — it's the VS Code workspace root and deleting
  // it causes the next test's Before hook to fail ("no workspace is opened").
  if (this.workspaceDir && this.workspaceDir !== BddWorld.BDD_WORKSPACE) {
    await fs.promises.rm(this.workspaceDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    this.workspaceDir = undefined;
  }

  await cleanBddWorkspace();
  await refreshFilesExplorer(workbox, evaluateInVSCode);

  // Dismiss any stray notifications
  for (const btn of await workbox.locator('.notification-toast button', { hasText: /Never|Don't show/i }).all()) {
    await btn.click().catch(() => {});
  }
});

async function cleanBddWorkspace(): Promise<void> {
  await fs.promises.mkdir(BddWorld.BDD_WORKSPACE, { recursive: true });
  const keep = new Set(['.gitignore', '.vscode']);
  for (const entry of await fs.promises.readdir(BddWorld.BDD_WORKSPACE, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue;
    await fs.promises.rm(path.join(BddWorld.BDD_WORKSPACE, entry.name), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

async function refreshFilesExplorer(
  workbox: Page,
  evaluateInVSCode: <R, Arg = void>(fn: (vscode: any, arg: Arg) => R, arg?: Arg) => Promise<R>
): Promise<void> {
  await evaluateInVSCode(vscode => {
    return (vscode as any).commands.executeCommand('workbench.files.action.refreshFilesExplorer');
  }).catch(() => {});
  await workbox.waitForTimeout(200);
}

async function closeOpenSvschTabs(workbox: Page, evaluateInVSCode?: any): Promise<void> {
  const tabs = workbox.locator('.tab[aria-label*="SVSCH"], .tab[title*="SVSCH"]');
  for (let i = 0; i < 3; i++) {
    const count = await tabs.count().catch(() => 0);
    if (count === 0) return;
    await tabs.first().click().catch(() => {});
    if (evaluateInVSCode) {
      await evaluateInVSCode((_vscode: any) => _vscode.commands.executeCommand('workbench.action.closeActiveEditor')).catch(() => {});
    } else {
      await workbox.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W').catch(() => {});
    }
    await workbox.waitForTimeout(200);
  }
}
