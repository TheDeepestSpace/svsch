import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildViewModel } from '../../src/layout/mergeLayout';
import { buildDesignGraph } from '../../src/parser/backend';
import type { DiagramViewModel } from '../../src/ir/types';
import type { SavedLayout } from '../../src/storage/layoutStore';
import {
  expectGraphAndScreenshot,
  fitGraphView,
  fixtureRoot,
  openView,
  waitForViewportTransformToSettle,
} from './helper';

// Issue #260 / PR #332: an instantiated child module's case-selector concat
// (`{transfersize, byte_index}`) looked up its enum/vector operand widths
// against the *parent* instance's connection list instead of the child
// module definition, corrupting the concat bus's tap widths. This mirrors
// test/unit/enum_concat_width.test.ts's two-file instantiation setup so the
// regression is also caught as a rendered diagram change, not just an IR
// assertion.
async function buildInstantiatedEnumConcatView(): Promise<DiagramViewModel> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svsch-visual-'));
  try {
    for (const fixtureName of ['enum_concat_case_top.sv', 'enum_concat_case.sv']) {
      fs.copyFileSync(path.join(fixtureRoot, fixtureName), path.join(tmpDir, fixtureName));
    }

    const surelogPath =
      process.env.SVSCH_SURELOG_PATH ?? path.resolve(__dirname, '../../dist/surelog/bin/surelog');
    const backendPath = path.resolve(__dirname, '../../dist/svsch_backend');

    const graph = await buildDesignGraph({
      workspaceRoot: tmpDir,
      projectFolder: '.',
      backend: (process.env.SVSCH_BACKEND as any) || 'uhdm',
      veriblePath: 'verible-verilog-syntax',
      surelogPath,
      backendPath,
      includeExternalDiagnostics: false,
    });

    const layout: SavedLayout = { version: 1, modules: {} };
    return buildViewModel(graph, 'enum_concat_case', layout);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function openInstantiatedEnumConcatFixture(page: Page): Promise<DiagramViewModel> {
  const view = await buildInstantiatedEnumConcatView();
  await openView(page, view);
  await page.waitForSelector('[data-node-kind="bus"]', { state: 'attached' });
  await waitForViewportTransformToSettle(page);
  await page.waitForTimeout(100);
  return view;
}

test.describe('instantiated enum concat case selector visual', () => {
  test('renders correct bus tap widths for an instantiated case-selector concat', async ({
    page,
  }) => {
    const view = await openInstantiatedEnumConcatFixture(page);
    await fitGraphView(page, 0.2);

    const bus = view.nodes.find(
      (node) => node.kind === 'bus' && node.id === 'bus:enum_concat_case:write_enable_sel:expr',
    );
    expect(bus).toBeDefined();
    expect(
      bus?.ports
        .filter((port) => port.direction === 'input')
        .map((port) => [port.connectedSignal, port.name, port.width]),
    ).toEqual([
      ['transfersize', '[3:2]', '[1:0]'],
      ['byte_index', '[1:0]', '[1:0]'],
    ]);
    expect(bus?.ports.find((port) => port.direction === 'output')?.width).toBe('[3:0]');

    const busNode = page.locator('[data-node-id="bus:enum_concat_case:write_enable_sel:expr"]');
    await expect(busNode).toBeVisible();
    await expect(busNode.locator('.svsch-bus-tap-label', { hasText: '[3:2]' })).toBeVisible();
    await expect(busNode.locator('.svsch-bus-tap-label', { hasText: '[1:0]' })).toBeVisible();

    await expectGraphAndScreenshot(page, 'enum-concat-case-instantiated.png');
  });
});
