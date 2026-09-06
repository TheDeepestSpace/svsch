import { test, expect } from 'vscode-test-playwright';
import type { FrameLocator, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PARTIAL_INTERACTION_CASES } from './partial_diagram_interactions.cases';

// ---------------------------------------------------------------------------
// "Does this diagram_interaction.feature behavior still hold inside a
// partial diagram?" (issue #408 review thread, option 3). Rather than
// duplicating each applicable scenario into partial_diagram.feature with a
// "[partial diagram]" suffix, one system-test case lives here per
// `@partial-parity`-tagged scenario — the same reasoning that already kept
// "Add to Partial" node-kind coverage (see partial_diagram_nodes.spec.ts) out
// of the BDD suite: each case needs its own from-scratch elaboration plus a
// full VS Code launch, and the BDD suite already runs once per supported
// VS Code version.
//
// partial_diagram_interactions.coverage.test.ts (plain vitest, no VS Code)
// is what keeps PARTIAL_INTERACTION_CASES honest against the feature file —
// see that file and partial_diagram_interactions.cases.ts for the full
// design. This file is deliberately just the runner: every case is declared
// via `test.fixme`, most with a body that documents the interaction still
// left to port rather than a working implementation.
//
// Only "Expanding an instance in place..." is fully implemented, as a single
// worked example: it needs no drag-gesture math (select, click, assert,
// click, assert), so it reuses the exact click/select helpers this suite's
// sibling node-kind test already exercises, adapted to a partial-diagram
// context. The other 16 cases involve real drag gestures (move/resize/
// reroute/multi-select) that test/steps/diagram.steps.ts already implements
// against the BddWorld fixture — porting those to vscode-test-playwright's
// lower-level workbox/evaluateInVSCode API is real, scenario-by-scenario
// work each needing its own live-environment debugging pass (see the
// comment on the node-kind test's own `test.fixme` for how many rounds that
// took), which a single non-interactive session can't responsibly fake. They
// stay as documented `test.fixme` stubs, still registered here — and so
// still enforced by the coverage test — so implementing one never silently
// leaves the rest unnoticed.
// ---------------------------------------------------------------------------

type EvaluateInVSCode = <R, Arg = void>(fn: (vscode: any, arg: Arg) => R, arg?: Arg) => Promise<R>;

const SYSTEM_LAYOUTS_DIR = path.resolve(__dirname, '../.svsch/layouts');

async function clearSystemLayout(): Promise<void> {
  await fs.promises.rm(SYSTEM_LAYOUTS_DIR, { recursive: true, force: true }).catch(() => {});
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

// Mirrors findFrameIndex in partial_diagram_nodes.spec.ts.
async function findFrameIndex(workbox: Page, panel: 'main' | 'partial'): Promise<number> {
  const selector =
    panel === 'partial' ? '.shell[data-svsch-partial="true"]' : '.shell:not([data-svsch-partial])';
  const deadline = Date.now() + 30_000;
  for (;;) {
    const count = await workbox.locator('iframe.webview').count();
    for (let index = 0; index < count; index++) {
      const outerFrame = workbox.locator('iframe.webview').nth(index);
      const visible = await outerFrame.isVisible().catch(() => false);
      if (!visible) continue;
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

function webviewAt(workbox: Page, frameIndex: number): FrameLocator {
  return workbox.frameLocator('iframe.webview').nth(frameIndex).frameLocator('iframe#active-frame');
}

// Mirrors findSystemNodeId in partial_diagram_nodes.spec.ts.
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

// Mirrors clickSystemNode in partial_diagram_nodes.spec.ts.
async function clickSystemNode(webview: FrameLocator, nodeId: string): Promise<void> {
  const node = webview.locator(`.react-flow__node[data-id="${nodeId}"]`);
  await node.waitFor({ state: 'visible' });
  await node.click({ force: true });

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

// Writes `files` to a fresh temp dir, points svsch.projectFolder at it
// (Workspace scope — see the equivalent comment in partial_diagram_nodes.spec.ts
// for why Global silently no-ops here), and opens the main diagram.
async function openMainDiagram(
  workbox: Page,
  evaluateInVSCode: EvaluateInVSCode,
  files: Record<string, string>,
): Promise<{ tmpDir: string; mainWebview: FrameLocator }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svsch-partial-interaction-'));
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmpDir, filename), content);
  }

  await evaluateInVSCode(
    (vscode, folder) =>
      vscode.workspace
        .getConfiguration('svsch')
        .update('projectFolder', folder, vscode.ConfigurationTarget.Workspace),
    tmpDir,
  );
  await evaluateInVSCode((vscode) => vscode.commands.executeCommand('svsch.openDiagram'));
  await workbox.waitForSelector('.tab[aria-label*="SVSCH Diagram"], .tab[title*="SVSCH Diagram"]', {
    timeout: 30_000,
  });

  const mainFrameIndex = await findFrameIndex(workbox, 'main');
  const mainWebview = webviewAt(workbox, mainFrameIndex);
  await mainWebview.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });

  return { tmpDir, mainWebview };
}

// Selects `nodeLabel` on the main diagram and adds it to the partial pane,
// returning a FrameLocator for that pane once it's populated.
async function addNodeToPartial(
  workbox: Page,
  evaluateInVSCode: EvaluateInVSCode,
  mainWebview: FrameLocator,
  nodeLabel: string,
  nodeKind?: string,
): Promise<FrameLocator> {
  const nodeId = await findSystemNodeId(mainWebview, nodeLabel, nodeKind);
  if (!nodeId) {
    throw new Error(`Could not find ${nodeKind ?? 'node'} "${nodeLabel}" in the main diagram`);
  }
  await clickSystemNode(mainWebview, nodeId);

  const addToPartialButton = mainWebview.locator('.svsch-selection-toolbar button', {
    hasText: 'Add to Partial',
  });
  await expect(addToPartialButton).toBeVisible();
  await addToPartialButton.click({ force: true });

  await workbox.waitForSelector(
    '.tab[aria-label*="SVSCH Partial Diagram"], .tab[title*="SVSCH Partial Diagram"]',
    { timeout: 30_000 },
  );
  await evaluateInVSCode((vscode) =>
    vscode.commands.executeCommand('workbench.action.moveEditorToFirstGroup'),
  );
  await workbox.waitForTimeout(300);

  const partialFrameIndex = await findFrameIndex(workbox, 'partial');
  const partialWebview = webviewAt(workbox, partialFrameIndex);
  await partialWebview.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });
  return partialWebview;
}

const casesByTitle = new Map(PARTIAL_INTERACTION_CASES.map((c) => [c.title, c]));

function notImplementedCase(title: string) {
  test.fixme(title, async () => {
    const notes = casesByTitle.get(title)?.notes ?? '';
    throw new Error(
      `Not yet implemented: port the partial-diagram-context version of the ` +
        `"${title}" scenario from test/features/diagram_interaction.feature. ${notes}`,
    );
  });
}

test.describe('Partial diagram interaction parity', () => {
  test.beforeEach(async () => {
    await clearSystemLayout();
  });

  // -- The one fully worked example -----------------------------------------
  const EXPAND_COLLAPSE_TITLE =
    'Expanding an instance in place inlines its child module, and Collapse restores it';
  test.fixme(EXPAND_COLLAPSE_TITLE, async ({ workbox, evaluateInVSCode }) => {
    await workbox.waitForSelector('.monaco-workbench', { timeout: 30_000 });
    await dismissSystemNotifications(workbox);

    const { mainWebview } = await openMainDiagram(workbox, evaluateInVSCode, {
      'top.sv': `
          module leaf(input logic a, output logic y);
            assign y = a;
          endmodule

          module top(input logic a, output logic y);
            leaf u1(.a(a), .y(y));
          endmodule
        `,
    });

    const partialWebview = await addNodeToPartial(
      workbox,
      evaluateInVSCode,
      mainWebview,
      'u1',
      'instance',
    );

    const u1Id = await findSystemNodeId(partialWebview, 'u1', 'instance');
    if (!u1Id) throw new Error('Instance "u1" did not render in the partial pane');
    await clickSystemNode(partialWebview, u1Id);

    const expandButton = partialWebview.locator('.svsch-selection-toolbar button', {
      hasText: 'Expand',
    });
    await expect(expandButton).toBeVisible();
    await expandButton.click({ force: true });

    await expect(
      partialWebview.locator('[data-node-kind="boundaryPort"] .hdl-boundary-port-text', {
        hasText: /^a$/,
      }),
    ).toBeVisible();
    await expect(
      partialWebview.locator('[data-node-kind="boundaryPort"] .hdl-boundary-port-text', {
        hasText: /^y$/,
      }),
    ).toBeVisible();
    await expect(partialWebview.locator(`.react-flow__node[data-id="${u1Id}"]`)).toHaveClass(
      /hdl-node-expand-ghost/,
    );

    // Collapsing re-selects the dimmed ghost node by clicking its header
    // strip (see "I collapse the expanded instance" in diagram.steps.ts for
    // why not its center/corner), then clicks the Collapse control the
    // selection toolbar swaps in for an expanded instance.
    const ghostBox = await partialWebview
      .locator(`.react-flow__node[data-id="${u1Id}"]`)
      .boundingBox();
    if (!ghostBox) {
      throw new Error('Could not get bounding box for the expanded "u1" ghost node');
    }
    await workbox.mouse.click(ghostBox.x + 30, ghostBox.y + 15);

    const collapseButton = partialWebview.locator('.svsch-selection-toolbar button', {
      hasText: 'Collapse',
    });
    await expect(collapseButton).toBeVisible();
    await collapseButton.click({ force: true });

    await expect(partialWebview.locator('.hdl-node-expand-ghost')).toHaveCount(0);
    const collapsedId = await findSystemNodeId(partialWebview, 'u1', 'instance');
    expect(collapsedId, 'Expected "u1" to render as a plain instance node again').not.toBeNull();
  });

  // -- Everything else: registered, still to be ported -----------------------
  for (const { title } of PARTIAL_INTERACTION_CASES) {
    if (title === EXPAND_COLLAPSE_TITLE) continue;
    notImplementedCase(title);
  }
});
