import { test as vsCodeTest } from 'vscode-test-playwright';
import { test as bddTest, createBdd } from 'playwright-bdd';
import { mergeTests } from '@playwright/test';
import type { Page, FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { buildDesignGraph } from '../../src/parser/backend';
import {
  buildViewModel,
  mergeNodePositions,
  mergeEdgeRoutePoints,
  mergeNetCut,
  mergeRerouteLayout,
  mergeRerouteSingleEdge,
  removeNetCut,
  renameCutNet,
} from '../../src/layout/mergeLayout';
import { captureGraphState, compareGraphState } from '../graphRegression';

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

  // Scenario metadata
  scenarioName?: string;
  scenarioId?: string;
  scenarioExampleIndex?: number;
  isScenarioOutline = false;
  isNaturalScenario = false;
  stepCounter = 0;
  updateSnapshots = false;
  nextCliSnapshotStepCounter?: number;

  // Diagram state
  layout: any = { version: 1, modules: {} };
  lastGraph?: any;
  lastCode?: string;
  lastViewModel?: any;

  // Message tracking (webview → extension)
  messages: any[] = [];

  // File state
  files: any[] = [];
  workspaceDir?: string;
  workspaceSources: Map<string, string> = new Map();
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
  notedRoutes: Map<string, string> = new Map();

  // -------------------------------------------------------------------------
  // Screenshot / snapshot helpers
  // -------------------------------------------------------------------------

  async takeScreenshot(label: string): Promise<Buffer | null> {
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
        const nodes = rf.getNodes().map((n: any) => ({
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
        }));
        const edges = rf.getEdges().map((e: any) => {
          const el = document.querySelector(`.react-flow__edge[data-id="${e.id}"] path.svsch-edge`);
          return { id: e.id, source: e.source, target: e.target,
            sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
            path: el?.getAttribute('d') ?? '' };
        });
        nodes.sort((a: any, b: any) => a.id.localeCompare(b.id));
        edges.sort((a: any, b: any) => a.id.localeCompare(b.id));
        return { nodes, edges };
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
    // In playwright-bdd the world fixture doesn't have direct attach access.
    // Attachments go via testInfo when needed; for now just log length.
    void buf;
    void contentType;
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
  static readonly EXTENSION_ROOT = path.resolve(__dirname, '../..');

  async postGraph(sources: { file: string; text: string }[]): Promise<void> {
    // Write source files into bdd-workspace so they appear in the Explorer.
    // The extension won't auto-rebuild because svsch.projectFolder points
    // to a non-existent subdirectory in the workspace settings.
    const workspaceRoot = BddWorld.BDD_WORKSPACE;
    this._bddWorkspaceFiles = [];
    for (const s of sources) {
      const fullPath = path.join(workspaceRoot, s.file);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, s.text);
      this._bddWorkspaceFiles.push(fullPath);
    }

    this.lastCode = sources[0].text;
    this.files = sources;

    const surelogPath = process.env.SURELOG_PATH || path.resolve(process.cwd(), 'dist/surelog/bin/surelog');
    const backendPath = process.env.BACKEND_PATH || path.resolve(process.cwd(), 'dist/svsch_backend');

    const graph = await buildDesignGraph({
      workspaceRoot,
      projectFolder: '.',
      backend: 'uhdm',
      veriblePath: 'verible-verilog-syntax',
      surelogPath,
      backendPath,
      includeExternalDiagnostics: false,
    });

    this.lastGraph = graph;
    const moduleName = graph.rootModules[0];
    const viewModel = await buildViewModel(graph, moduleName, this.layout);
    this.lastViewModel = viewModel;
    this.layout = mergeNodePositions(this.layout, moduleName, viewModel.nodes);

    if (!await this._hasCapturedPanel()) return;

    // Wait for webview to signal ready before posting the graph.
    await this._waitForWebviewReady();
    await this._postGraphToWebview(viewModel, Object.keys(graph.modules));
    // Ensure the SVSCH webview panel is in the foreground.
    await this._revealPanel();
    await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });
    await this.workbox.waitForTimeout(1000);
    await this.takeScreenshot(`Viewing module ${moduleName}`);
  }

  async openWorkspaceForEditing(sources: { file: string; text: string }[]): Promise<void> {
    if (this.workspaceDir) {
      await fs.promises.rm(this.workspaceDir, { recursive: true, force: true });
    }
    this.workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'svsch-bdd-cli-'));
    this.workspaceSources.clear();
    for (const source of sources) {
      this.workspaceSources.set(source.file, source.text);
    }
    await this._writeWorkspaceSources();
    await this._postWorkspaceGraph();
  }

  async updateWorkspaceFile(filename: string, text: string): Promise<void> {
    if (!this.workspaceDir) throw new Error('No open workspace. Use "I have opened ... for editing" first.');
    this.workspaceSources.set(filename, text);
    await this._writeWorkspaceSources();
    await this._postWorkspaceGraph();
  }

  private async _writeWorkspaceSources(): Promise<void> {
    if (!this.workspaceDir) throw new Error('No open workspace');
    for (const [file, text] of this.workspaceSources) {
      const fullPath = path.join(this.workspaceDir, file);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, text);
    }
    this.files = Array.from(this.workspaceSources, ([file, text]) => ({ file, text }));
    this.lastCode = this.files[0]?.text;
  }

  private async _postWorkspaceGraph(): Promise<void> {
    if (!this.workspaceDir) throw new Error('No open workspace');

    const surelogPath = process.env.SURELOG_PATH || path.resolve(process.cwd(), 'dist/surelog/bin/surelog');
    const backendPath = process.env.BACKEND_PATH || path.resolve(process.cwd(), 'dist/svsch_backend');

    const graph = await buildDesignGraph({
      workspaceRoot: this.workspaceDir,
      projectFolder: '.',
      backend: 'uhdm',
      veriblePath: 'verible-verilog-syntax',
      surelogPath,
      backendPath,
      includeExternalDiagnostics: false,
    });

    this.lastGraph = graph;
    const moduleName = graph.rootModules[0];
    const viewModel = await buildViewModel(graph, moduleName, this.layout);
    this.lastViewModel = viewModel;
    this.layout = mergeNodePositions(this.layout, moduleName, viewModel.nodes);

    if (!await this._hasCapturedPanel()) return;

    await this._revealPanel();
    await this._waitForWebviewReady();
    await this._postGraphToWebview(viewModel, Object.keys(graph.modules));
    await this._waitForRenderedGraph(viewModel, Object.keys(graph.modules), 15_000);
    await this.workbox.waitForTimeout(500);
    await this.takeScreenshot(`Viewing module ${moduleName}`);
  }

  async selectModule(
    moduleName: string,
    screenshotLabel: string | false = `Viewing module ${moduleName}`
  ): Promise<void> {
    const graph = this.lastGraph;
    const viewModel = await buildViewModel(graph, moduleName, this.layout);
    this.lastViewModel = viewModel;
    this.layout = mergeNodePositions(this.layout, moduleName, viewModel.nodes);

    await this._waitForWebviewReady();
    await this._postGraphToWebview(viewModel, Object.keys(graph.modules));
    await this._revealPanel();
    await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
    await this.workbox.waitForTimeout(500);
    if (screenshotLabel) await this.takeScreenshot(screenshotLabel);
  }

  async webviewMessages(): Promise<any[]> {
    return this.evaluateInVSCode(() => (global as any).__svschBddReceivedMessages ?? []);
  }

  async openCapturedDiagramPanel(): Promise<void> {
    if (await this._hasCapturedPanel()) {
      await this._revealPanel();
      return;
    }

    await this.evaluateInVSCode((vscode, extensionRoot) => {
      const panel = (vscode as any).window.createWebviewPanel('svsch.diagram', 'SVSCH Diagram', (vscode as any).ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [(vscode as any).Uri.joinPath((vscode as any).Uri.file(extensionRoot), 'media')],
      });
      const webview = panel.webview;
      const mediaUri = (fileName: string) => {
        const uri = (vscode as any).Uri.joinPath((vscode as any).Uri.file(extensionRoot), 'media', fileName);
        return webview.asWebviewUri(uri).with({ query: `v=${Date.now()}` }).toString();
      };
      const nonce = String(Date.now());
      const scriptUri = mediaUri('webview.js');
      const styleUri = mediaUri('webview.css');
      webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} https:; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>SVSCH Diagram</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }, BddWorld.EXTENSION_ROOT);

    await this.workbox.waitForSelector(
      '.tab[aria-label*="SVSCH"], .tab[title*="SVSCH"]',
      { timeout: 30_000 }
    );
    await this._waitForCapturedPanel();
  }

  private async _hasCapturedPanel(): Promise<boolean> {
    return this.evaluateInVSCode(() => !!(global as any).__svschBddPanel);
  }

  private async _waitForCapturedPanel(): Promise<void> {
    for (let i = 0; i < 40; i++) {
      if (await this._hasCapturedPanel()) return;
      await this.workbox.waitForTimeout(250);
    }
    throw new Error('BDD interceptor: svsch.diagram panel was not captured within timeout');
  }

  // -------------------------------------------------------------------------
  // Internal: wait until the webview React app has registered its listener
  // -------------------------------------------------------------------------

  async _waitForWebviewReady(): Promise<void> {
    // The webview sends { type: 'ready' } after its useEffect registers the
    // message listener. We wait for that before posting graph data.
    // Also accept 'layoutChanged' or 'ready' — any message means the app is live.
    const alreadyReady = await this.evaluateInVSCode(() => {
      const msgs: any[] = (global as any).__svschBddReceivedMessages ?? [];
      return msgs.some((m: any) => m.type === 'ready');
    });
    if (alreadyReady) return;

    // Not yet ready — wait up to 15s for the ready message to arrive.
    for (let i = 0; i < 60; i++) {
      await this.workbox.waitForTimeout(250);
      const ready = await this.evaluateInVSCode(() => {
        const msgs: any[] = (global as any).__svschBddReceivedMessages ?? [];
        return msgs.some((m: any) => m.type === 'ready');
      });
      if (ready) return;
    }
    // Log a warning but don't throw — the message might still work without ready handshake.
    console.warn('[BDD] Warning: webview did not send ready within 15s');
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

  // -------------------------------------------------------------------------
  // Internal: deliver a graph message to the VSCode webview via the extension host
  // -------------------------------------------------------------------------

  private async _postGraphToWebview(
    view: any,
    modules: string[]
  ): Promise<void> {
    // Serialize here to avoid any CDP serialization quirks with deep objects.
    const jsonStr = JSON.stringify({ type: 'graph', view, modules });

    const result = await this.evaluateInVSCode(
      (_vscode, json) => {
        const panel = (global as any).__svschBddPanel;
        if (!panel) return 'no-panel';
        try {
          const data = JSON.parse(json);
          void panel.webview.postMessage(data);
          return `ok:${data.view?.nodes?.length ?? 0}nodes`;
        } catch (e: any) {
          return `error:${String(e)}`;
        }
      },
      jsonStr
    );
    console.log('[BDD] _postGraphToWebview result:', result);
    if (!result || result === 'no-panel') {
      throw new Error(`[BDD] postGraph failed: panel is gone (disposed). Result: ${result}`);
    }
  }

  private async _waitForRenderedGraph(view: any, modules: string[], timeout: number): Promise<void> {
    const firstNode = this.webviewPage.locator('.react-flow__node').first();
    try {
      await firstNode.waitFor({ timeout });
    } catch (err) {
      console.warn('[BDD] Warning: graph did not render after initial post; reposting once');
      await this._revealPanel();
      await this._postGraphToWebview(view, modules);
      await firstNode.waitFor({ timeout });
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
  world: async ({ workbox, evaluateInVSCode }, use) => {
    const w = new BddWorld();
    w.workbox = workbox;
    w.webviewPage = workbox
      .frameLocator('iframe.webview')
      .frameLocator('iframe#active-frame');
    w.evaluateInVSCode = evaluateInVSCode as any;
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
  this.isNaturalScenario = ($bddContext?.tags ?? []).includes('@natural');
  this.updateSnapshots = shouldUpdateSnapshots($testInfo);

  // Remove any on-disk layout that accumulated from the previous scenario
  // (drag operations write to .svsch/layout.json; we inject our own layout so
  //  we don't want stale positions leaking in if the extension ever reads it again)
  const layoutPath = path.join(BddWorld.BDD_WORKSPACE, '.svsch', 'layout.json');
  await fs.promises.rm(layoutPath, { force: true });
  await cleanBddWorkspace();

  // Reset per-scenario state
  this.layout = { version: 1, modules: {} };
  this.lastGraph = undefined;
  this.lastCode = undefined;
  this.lastViewModel = undefined;
  this.messages = [];
  this.files = [];
  this.workspaceSources = new Map();
  this.workspaceDirStateBefore = undefined;
  this.lastCliSvg = undefined;
  this.lastCliSvgPath = undefined;
  this.lastCliPng = undefined;
  this.lastCliPngPath = undefined;
  this.lastCliStdout = undefined;
  this.lastCliStderr = undefined;
  this.nextCliSnapshotStepCounter = undefined;
  this.stepCounter = 0;
  this.isNaturalScenario = ($bddContext?.tags ?? []).includes('@natural');
  this.updateSnapshots = shouldUpdateSnapshots($testInfo);
  this.notedPositions = new Map();
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
  // @natural scenarios override this in their own "When I open VS Code to X" step.
  await evaluateInVSCode(_vscode => {
    return (_vscode as any).workspace
      .getConfiguration('svsch')
      .update('projectFolder', './no-sv-files-here', (_vscode as any).ConfigurationTarget.Workspace);
  });

  await closeOpenSvschTabs(workbox);

  // Install panel interceptor (captures the webview panel so we can inject messages)
  await evaluateInVSCode(_vscode => {
    try { (global as any).__svschBddPanel?.dispose?.(); } catch {}
    (global as any).__svschBddPanel = null;
    (global as any).__svschBddReceivedMessages = [];

    // Idempotent: only patch once per VSCode session
    if ((global as any).__svschBddInterceptorInstalled) {
      return;
    }
    (global as any).__svschBddInterceptorInstalled = true;

    const origCreatePanel = (_vscode as any).window.createWebviewPanel;
    (_vscode as any).window.createWebviewPanel = function (viewType: string, title: string, ...args: any[]) {
      const panel = origCreatePanel.call((_vscode as any).window, viewType, title, ...args);
      if (viewType === 'svsch.diagram') {
        (global as any).__svschBddPanel = panel;
        (global as any).__svschBddReceivedMessages = [];

        // Accumulate webview → extension messages
        panel.webview.onDidReceiveMessage((msg: any) => {
          ((global as any).__svschBddReceivedMessages ??= []).push(msg);
        });

        // Expose a way to fire a message INTO the extension's listener
        // (used by steps that simulate the webview sending messages back)
        const origOnReceive = panel.webview.onDidReceiveMessage.bind(panel.webview);
        const listeners: Array<(msg: any) => void> = [];
        panel.webview.onDidReceiveMessage = function (listener: any, thisArg?: any, disposables?: any) {
          listeners.push(thisArg ? listener.bind(thisArg) : listener);
          return origOnReceive(listener, thisArg, disposables);
        };
        (global as any).__svschBddFireMessage = (msg: any) => {
          for (const l of listeners) l(msg);
        };

        // Track panel disposal so we know when to re-intercept
        panel.onDidDispose(() => {
          (global as any).__svschBddPanel = null;
        });
      }
      return panel;
    };
  });

});

After(async function (this: BddWorld, { workbox }: any) {
  // Clean up .sv files written to bdd-workspace during this scenario
  for (const f of this._bddWorkspaceFiles) {
    await fs.promises.rm(f, { force: true });
  }
  this._bddWorkspaceFiles = [];

  // Remove on-disk layout so it doesn't persist into the next scenario
  const layoutPath = path.join(BddWorld.BDD_WORKSPACE, '.svsch', 'layout.json');
  await fs.promises.rm(layoutPath, { force: true });

  // Clean up workspace temp dir (used by CLI/openWorkspaceForEditing steps)
  if (this.workspaceDir) {
    await fs.promises.rm(this.workspaceDir, { recursive: true, force: true });
    this.workspaceDir = undefined;
  }

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
    });
  }
}

async function closeOpenSvschTabs(workbox: Page): Promise<void> {
  const tabs = workbox.locator('.tab[aria-label*="SVSCH"], .tab[title*="SVSCH"]');
  for (let i = 0; i < 3; i++) {
    const count = await tabs.count().catch(() => 0);
    if (count === 0) return;
    await tabs.first().click().catch(() => {});
    await workbox.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W').catch(() => {});
    await workbox.waitForTimeout(200);
  }
}
