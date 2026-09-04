import { test, expect } from 'vscode-test-playwright';
import type { FrameLocator } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import {
  type EvaluateInVSCode,
  clearSystemLayout,
  openSystemDiagram,
  openSystemModule,
} from './helpers';

interface HighlightExpectation {
  kind: string;
  label?: string;
}

interface HighlightCase {
  id: string;
  module: string;
  file: string;
  select: string;
  exclusive?: boolean;
  expect: HighlightExpectation[];
}

const root = path.resolve(__dirname, '../..');
const { cases } = yaml.load(
  fs.readFileSync(path.join(__dirname, 'selection-highlight.cases.yaml'), 'utf8'),
) as { cases: HighlightCase[] };

// Selection → highlight is pure extension/webview logic with no VS Code API
// surface that varies across the supported builds, so running the sweep on
// every version would only re-prove the same mapping at 3× the suite cost.
// Pin it to the oldest supported build (the compatibility floor) and keep it
// out of the per-version screenshot/versioning scheme entirely — all
// assertions here are declarative, no baselines.
const versions: string[] = JSON.parse(
  fs.readFileSync(path.join(root, 'vscode-versions.json'), 'utf8'),
);
const oldestVersion = versions.slice().sort((a, b) => compareVersions(a, b))[0];
// Default mirrors test/system/playwright.config.ts's vscodeVersion fallback.
const currentVersion = process.env.VSCODE_VERSION || '1.91.0';

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

test.skip(
  currentVersion !== oldestVersion,
  `selection-highlight sweep runs only on the oldest supported VS Code (${oldestVersion})`,
);

test('highlights the declared diagram nodes for each selected source construct', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // One VS Code session walks every case (module switches are cheap; a fresh
  // session + Surelog elaboration per case would not be).
  test.setTimeout(600_000);
  await clearSystemLayout();
  try {
    await openSystemDiagram(workbox, evaluateInVSCode);

    const webview = workbox.frameLocator('iframe.webview').frameLocator('iframe#active-frame');
    await webview.locator('.shell').waitFor({ state: 'visible', timeout: 30_000 });

    // Same arrangement as the BDD "I arrange the diagram and the editor side
    // by side" step: two editor groups so the source file opened below never
    // tabs over (and thereby hides) the diagram webview.
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('vscode.setEditorLayout', {
        orientation: 1,
        groups: [{}, {}],
      });
    });

    for (const highlightCase of cases) {
      await test.step(highlightCase.id, async () => {
        await openSystemModule(workbox, webview, evaluateInVSCode, highlightCase.module);
        await selectSourceText(evaluateInVSCode, highlightCase.file, highlightCase.select);
        await assertHighlightedNodes(webview, highlightCase);
      });
    }
  } finally {
    await clearSystemLayout();
  }
});

// Mirrors the BDD "I select the source text {string} in {string}" step.
async function selectSourceText(
  evaluateInVSCode: EvaluateInVSCode,
  filename: string,
  sourceText: string,
): Promise<void> {
  await evaluateInVSCode(
    async (vscode, selection: { filename: string; sourceText: string }) => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceRoot) throw new Error('No workspace folder is open');
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(workspaceRoot, selection.filename),
      );
      const offset = document.getText().indexOf(selection.sourceText);
      if (offset < 0) {
        throw new Error(`Source text not found in ${selection.filename}: ${selection.sourceText}`);
      }
      const range = new vscode.Range(
        document.positionAt(offset),
        document.positionAt(offset + selection.sourceText.length),
      );
      await vscode.window.showTextDocument(document, {
        // The diagram occupies the first (top) group; target the second so
        // the source file doesn't tab over it.
        viewColumn: vscode.ViewColumn.Two,
        selection: range,
      });
    },
    { filename, sourceText },
  );
}

async function assertHighlightedNodes(
  webview: FrameLocator,
  highlightCase: HighlightCase,
): Promise<void> {
  let lastHighlighted: Array<{ kind: string; label: string }> = [];
  await expect
    .poll(
      async () => {
        lastHighlighted = await webview.locator('html').evaluate(() => {
          const rf = (window as any).reactFlowInstance;
          return (rf?.getNodes?.() ?? [])
            .filter((node: any) => node.selected === true)
            .map((node: any) => ({
              kind: node.data?.node?.kind ?? '',
              label: node.data?.node?.label ?? '',
            }));
        });
        return highlightedSetMatches(lastHighlighted, highlightCase);
      },
      {
        timeout: 15_000,
        message:
          `Case ${highlightCase.id}: expected ${JSON.stringify(highlightCase.expect)} ` +
          `(exclusive: ${highlightCase.exclusive !== false}), ` +
          `last highlighted: ${JSON.stringify(lastHighlighted)}`,
      },
    )
    .toBe(true);
}

function highlightedSetMatches(
  highlighted: Array<{ kind: string; label: string }>,
  highlightCase: HighlightCase,
): boolean {
  const unmatched = [...highlighted];
  for (const expected of highlightCase.expect) {
    const index = unmatched.findIndex(
      (node) =>
        node.kind === expected.kind &&
        (expected.label === undefined || node.label === expected.label),
    );
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return highlightCase.exclusive === false || unmatched.length === 0;
}
