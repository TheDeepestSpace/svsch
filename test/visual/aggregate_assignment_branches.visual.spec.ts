import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, fitGraphView, openFixture, paddedAllNodesClip } from './helper';

// Regression coverage for #257: a concat-LHS non-blocking assign repeated
// across an if/else-if chain used to get lowered twice, producing duplicate
// register nodes with a 5-way driver-edge fan-in and a node displaced an
// order of magnitude away from the rest of the (tiny) module by ELK's
// layered cycle-breaking. This is the exact module from the bug report.
test.describe('aggregate assignment branches visual rendering', () => {
  test('renders a concat-LHS register driven by one priority mux per branch chain', async ({
    page,
  }) => {
    const view = await openFixture(
      page,
      'aggregate_assignment_branches.sv',
      'auto',
      'aggregate_assignment_branches',
    );

    const registers = view.nodes.filter((node) => node.kind === 'register');
    expect(registers.map((node) => node.id).sort()).toEqual([
      'reg:aggregate_assignment_branches:data_reg',
      'reg:aggregate_assignment_branches:data_valid',
    ]);

    for (const register of registers) {
      const dDrivers = view.edges.filter(
        (edge) => edge.target === register.id && edge.targetPort === 'd',
      );
      expect(dDrivers).toHaveLength(1);
      expect(view.nodes.find((node) => node.id === dDrivers[0].source)?.kind).toBe('mux');
    }

    // Guards the layout-displacement symptom directly: before the fix, the
    // duplicate-fed registers landed ~10000px below the rest of this
    // 8-signal module instead of in the same tight cluster.
    const allYs = view.nodes.map((node) => node.position.y);
    const ySpan = Math.max(...allYs) - Math.min(...allYs);
    expect(ySpan).toBeLessThan(1000);

    await expect(page.locator('[data-node-kind="register"]')).toHaveCount(2);

    await fitGraphView(page);
    await expectGraphAndScreenshot(page, 'aggregate-assignment-branches-canvas.png', {
      clip: await paddedAllNodesClip(page),
    });
  });
});
