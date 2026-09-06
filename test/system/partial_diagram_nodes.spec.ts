import { test, expect } from 'vscode-test-playwright';
import type { FrameLocator, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// "Add to Partial" coverage for every node kind the syntax book documents
// (issue #408 review thread). Rather than hand-authoring a second set of tiny
// fixtures, this reuses test/syntax-book/cases/*.yaml — the same cases the
// syntax book itself is generated and verified from (see
// test/syntax-book/syntax-book.spec.ts) — so this suite tracks the syntax
// book automatically as node kinds are added there.
//
// Deliberately ONE test with an internal loop rather than one test per node
// kind: the system suite already runs every test once per supported VS Code
// version (see vscode-versions.json / scripts/run-system-tests.js), and each
// case here needs its own from-scratch Surelog elaboration, so N separate
// tests would multiply full-VSCode-launch overhead by N — the exact kind of
// system-suite runtime growth flagged in review for this PR.
// ---------------------------------------------------------------------------

type EvaluateInVSCode = <R, Arg = void>(fn: (vscode: any, arg: Arg) => R, arg?: Arg) => Promise<R>;

const SYNTAX_BOOK_SECTION_FILES = [
  'ports.yaml',
  'modules_hierarchy.yaml',
  'registers.yaml',
  'muxes.yaml',
  'combinational_logic.yaml',
  'wiring.yaml',
  'buses.yaml',
  'structs.yaml',
  'interfaces.yaml',
  'generate.yaml',
  'other.yaml',
];
const SYNTAX_BOOK_CASES_DIR = path.resolve(__dirname, '../syntax-book/cases');

interface SyntaxBookNodeCase {
  id: string;
  files: Record<string, string>;
  module: string;
  target: { kind: string; nodeKind: string; nodeLabel: string };
}

// One representative case per distinct node kind the syntax book documents —
// the first case of that kind, in syntax-book section order. `netLabel` and
// `region` targets are excluded: "Add to Partial" only ever operates on real
// selectable blocks (see `selectedBlocks` in src/webview/main.tsx), which a
// cut-net label or a generate region is not.
function loadOneCasePerNodeKind(): SyntaxBookNodeCase[] {
  const byKind = new Map<string, SyntaxBookNodeCase>();
  for (const file of SYNTAX_BOOK_SECTION_FILES) {
    const filePath = path.join(SYNTAX_BOOK_CASES_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const section = yaml.load(fs.readFileSync(filePath, 'utf8')) as { cases: SyntaxBookNodeCase[] };
    for (const caseData of section.cases) {
      const target = caseData.target;
      if (target?.kind === 'node' && target.nodeKind && !byKind.has(target.nodeKind)) {
        byKind.set(target.nodeKind, caseData);
      }
    }
  }
  return [...byKind.values()];
}

const NODE_CASES = loadOneCasePerNodeKind();
const SYSTEM_LAYOUTS_DIR = path.resolve(__dirname, '../.svsch/layouts');

test.describe('Add to Partial — every supported node kind', () => {
  test(`clones one node of each of the ${NODE_CASES.length} supported kinds into the partial diagram`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    // Every case needs its own Surelog elaboration plus a full UI round trip;
    // give the loop generous headroom over the suite's 240s default.
    test.setTimeout(Math.max(240_000, NODE_CASES.length * 45_000));

    await clearSystemLayout();
    await workbox.waitForSelector('.monaco-workbench', { timeout: 30_000 });
    await dismissSystemNotifications(workbox);
    await installSystemWebviewBridge(evaluateInVSCode);

    const originalProjectFolder =
      (await evaluateInVSCode((vscode) =>
        vscode.workspace.getConfiguration('svsch').get('projectFolder'),
      )) ?? './fixtures';

    const tmpDirs: string[] = [];
    let diagramOpened = false;

    try {
      for (const caseData of NODE_CASES) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `svsch-partial-node-${caseData.id}-`));
        tmpDirs.push(tmpDir);
        for (const [filename, content] of Object.entries(caseData.files)) {
          fs.writeFileSync(path.join(tmpDir, filename), content);
        }

        const graphCountBefore = await currentGraphCount(evaluateInVSCode);

        // Global, not Workspace: this must not write to the checked-in
        // test/.vscode/settings.json — it only needs to live for the
        // duration of this single Electron launch.
        await evaluateInVSCode(
          (vscode, folder) =>
            vscode.workspace
              .getConfiguration('svsch')
              .update('projectFolder', folder, vscode.ConfigurationTarget.Global),
          tmpDir,
        );

        if (!diagramOpened) {
          await evaluateInVSCode((vscode) => vscode.commands.executeCommand('svsch.openDiagram'));
          await workbox.waitForSelector(
            '.tab[aria-label*="SVSCH Diagram"], .tab[title*="SVSCH Diagram"]',
            { timeout: 30_000 },
          );
          diagramOpened = true;
        } else {
          // Config-change re-elaboration is the same path svsch.setProjectFolder
          // itself drives (see src/extension.ts) — more direct than relying on
          // the debounced onDidChangeConfiguration watcher's own timing.
          await evaluateInVSCode((vscode) =>
            vscode.commands.executeCommand('svsch.rebuildDiagram'),
          );
        }

        await expect
          .poll(() => currentGraphCount(evaluateInVSCode), { timeout: 30_000 })
          .toBeGreaterThan(graphCountBefore);

        const mainFrameIndex = await findFrameIndex(workbox, 'main');
        const mainWebview = workbox
          .frameLocator('iframe.webview')
          .nth(mainFrameIndex)
          .frameLocator('iframe#active-frame');
        await mainWebview.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });
        await waitForViewportToSettle(mainWebview);

        const targetLabel = caseData.target.nodeLabel;
        const targetKind = caseData.target.nodeKind;
        await expect
          .poll(
            async () => (await findSystemNodeId(mainWebview, targetLabel, targetKind)) !== null,
            { timeout: 15_000 },
          )
          .toBe(true);
        const nodeId = await findSystemNodeId(mainWebview, targetLabel, targetKind);
        if (!nodeId) {
          throw new Error(
            `[${caseData.id}] Could not find ${targetKind} node "${targetLabel}" in the main diagram`,
          );
        }

        const partialBlocksBefore = await countPartialPaneBlocks(workbox);

        await clickSystemNode(workbox, mainWebview, nodeId);
        const addToPartialButton = mainWebview.locator('.svsch-selection-toolbar button', {
          hasText: 'Add to Partial',
        });
        await expect(addToPartialButton).toBeVisible();
        await addToPartialButton.click();

        await expect
          .poll(() => countPartialPaneBlocks(workbox), { timeout: 30_000 })
          .toBeGreaterThan(partialBlocksBefore ?? 0);

        const partialTabs = workbox.locator(
          '.tab[aria-label*="SVSCH Partial Diagram"], .tab[title*="SVSCH Partial Diagram"]',
        );
        // The pane opens beside the main diagram (ViewColumn.Beside, see
        // src/partialDiagramPanel.ts), splitting the window in two. Move it
        // into the main diagram's own tab group so the screenshot below
        // captures the partial diagram at full window width while it's being
        // assembled, rather than a half-width split view.
        await partialTabs.first().click();
        await evaluateInVSCode((vscode) =>
          vscode.commands.executeCommand('workbench.action.moveEditorToFirstGroup'),
        );
        // Let the now-single-group relayout settle before the next capture.
        await workbox.waitForTimeout(300);

        const partialFrameIndex = await findFrameIndex(workbox, 'partial');
        const partialWebview = workbox
          .frameLocator('iframe.webview')
          .nth(partialFrameIndex)
          .frameLocator('iframe#active-frame');

        const partialNodeId = await findSystemNodeId(partialWebview, targetLabel, targetKind);
        expect(
          partialNodeId,
          `[${caseData.id}] Expected the ${targetKind} node to render in the partial diagram pane`,
        ).not.toBeNull();

        await waitForViewportToSettle(partialWebview);
        await dismissSystemNotifications(workbox);
        await workbox.waitForTimeout(300);
        await expect(workbox).toHaveScreenshot(`partial-diagram-node-${targetKind}.png`);

        // Every case reuses module name "top" (that's what the syntax book's
        // fixtures are all called) but with entirely different content each
        // time. PartialDiagramPanel only restarts its state when the source
        // *module name* changes (v1 scope, see addNodes in
        // src/partialDiagramPanel.ts), so close the pane after each case
        // instead of relying on that name-based reset — the next "Add to
        // Partial" click then always builds a genuinely fresh pane.
        await partialTabs.first().click();
        await workbox.waitForTimeout(300);
        await evaluateInVSCode((vscode) =>
          vscode.commands.executeCommand('workbench.action.closeActiveEditor'),
        );
        await expect(partialTabs).toHaveCount(0);
      }
    } finally {
      await evaluateInVSCode(
        (vscode, folder) =>
          vscode.workspace
            .getConfiguration('svsch')
            .update('projectFolder', folder, vscode.ConfigurationTarget.Global),
        originalProjectFolder,
      );
      for (const dir of tmpDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      await clearSystemLayout();
    }
  });
});

async function clearSystemLayout(): Promise<void> {
  await fs.promises.rm(SYSTEM_LAYOUTS_DIR, { recursive: true, force: true }).catch(() => {});
}

async function currentGraphCount(evaluateInVSCode: EvaluateInVSCode): Promise<number> {
  return evaluateInVSCode((vscode) => {
    void vscode;
    return (global as any).__svschGraphCount ?? 0;
  });
}

async function dismissSystemNotifications(workbox: Page): Promise<void> {
  for (const button of await workbox
    .locator('.notification-toast button', { hasText: /Never|Don't show/i })
    .all()) {
    await button.click().catch(() => {});
  }
  const closeAll = workbox.locator('.notifications-toasts .codicon-notifications-clear-all');
  if (await closeAll.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeAll.click().catch(() => {});
  }
}

// Mirrors installSystemWebviewBridge in diagram.spec.ts: patches
// createWebviewPanel before svsch.openDiagram ever fires so every graph
// message posted to the main panel's webview is counted, independent of
// whichever module/project it currently reflects.
async function installSystemWebviewBridge(evaluateInVSCode: EvaluateInVSCode): Promise<void> {
  await evaluateInVSCode((vscode) => {
    if ((global as any).__svschSystemBridgeInstalled) return;
    (global as any).__svschSystemBridgeInstalled = true;

    const origCreatePanel = vscode.window.createWebviewPanel;
    (vscode.window as any).createWebviewPanel = function (
      viewType: string,
      title: string,
      ...args: any[]
    ) {
      const panel = (origCreatePanel as any).call(vscode.window, viewType, title, ...args);
      if (viewType !== 'svsch.diagram') {
        return panel;
      }

      const origPostMessage = panel.webview.postMessage.bind(panel.webview);
      panel.webview.postMessage = (msg: any) => {
        if (msg?.type === 'graph') {
          (global as any).__svschGraphCount = ((global as any).__svschGraphCount ?? 0) + 1;
        }
        return origPostMessage(msg);
      };

      return panel;
    };
  });
}

// Mirrors BddWorld.findPanelFrameIndex (test/steps/fixtures.ts): the partial
// pane's shell carries data-svsch-partial="true", the main diagram's doesn't.
async function findFrameIndex(workbox: Page, panel: 'main' | 'partial'): Promise<number> {
  const selector =
    panel === 'partial' ? '.shell[data-svsch-partial="true"]' : '.shell:not([data-svsch-partial])';
  const deadline = Date.now() + 30_000;
  for (;;) {
    const count = await workbox.locator('iframe.webview').count();
    for (let index = 0; index < count; index++) {
      const matches = await workbox
        .frameLocator('iframe.webview')
        .nth(index)
        .frameLocator('iframe#active-frame')
        .locator(selector)
        .count()
        .catch(() => 0);
      if (matches > 0) {
        return index;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`No ${panel} diagram webview found within 30s`);
    }
    await workbox.waitForTimeout(250);
  }
}

// The number of real (non-label) blocks currently rendered in the partial
// pane, or null while no partial pane webview exists yet — mirrors
// partialPaneBlockCount in test/steps/partial.steps.ts.
async function countPartialPaneBlocks(workbox: Page): Promise<number | null> {
  const frames = await workbox.locator('iframe.webview').count();
  for (let index = 0; index < frames; index++) {
    const frame = workbox
      .frameLocator('iframe.webview')
      .nth(index)
      .frameLocator('iframe#active-frame');
    const isPartial = await frame
      .locator('.shell[data-svsch-partial="true"]')
      .count()
      .catch(() => 0);
    if (isPartial > 0) {
      return frame
        .locator('.react-flow__node:not([data-node-kind="netLabel"])')
        .count()
        .catch(() => 0);
    }
  }
  return null;
}

async function waitForViewportToSettle(webview: FrameLocator): Promise<void> {
  await webview.locator('body').evaluate(async () => {
    const getTransform = () =>
      (document.querySelector('.react-flow__viewport') as HTMLElement)?.style.transform ?? '';
    let last = getTransform();
    let stable = 0;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const current = getTransform();
      stable = current === last && current !== '' ? stable + 1 : 0;
      last = current;
      if (stable >= 5) break;
    }
    if (stable < 5) {
      throw new Error('React Flow viewport did not settle within 5 seconds');
    }
  });
  await webview.locator('body').evaluate(() => document.fonts.ready);
}

async function findSystemNodeId(
  webview: FrameLocator,
  label: string,
  kind?: string,
): Promise<string | null> {
  return webview.locator('html').evaluate(
    (_element, { wantedLabel, wantedKind }) => {
      const rf = (window as any).reactFlowInstance;
      const node = rf
        ?.getNodes?.()
        .find(
          (candidate: any) =>
            candidate.data?.node?.label === wantedLabel &&
            (!wantedKind || candidate.data?.node?.kind === wantedKind),
        );
      if (node) return node.id;

      const domNodes = Array.from(document.querySelectorAll('.react-flow__node'));
      const domNode = domNodes.find((element) => {
        if (wantedKind && !element.querySelector(`[data-node-kind="${wantedKind}"]`)) return false;
        const labels = Array.from(
          element.querySelectorAll(
            '.port-skin-label,.node-title,.node-kind,.svsch-node-title,.svsch-node-kind,' +
              '.svsch-port-label',
          ),
        )
          .map((child) => child.textContent?.trim())
          .filter(Boolean);
        return labels.includes(wantedLabel);
      });
      return domNode?.getAttribute('data-id') ?? null;
    },
    { wantedLabel: label, wantedKind: kind },
  );
}

async function clickSystemNode(
  workbox: Page,
  webview: FrameLocator,
  nodeId: string,
): Promise<void> {
  const box = await webview.locator(`.react-flow__node[data-id="${nodeId}"]`).boundingBox();
  if (!box) {
    throw new Error(`Could not get node box for ${nodeId}`);
  }
  await workbox.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect
    .poll(
      async () =>
        webview.locator('html').evaluate((_element, id) => {
          const rf = (window as any).reactFlowInstance;
          return rf?.getNode?.(id)?.selected ?? false;
        }, nodeId),
      { timeout: 5_000 },
    )
    .toBe(true);
}
