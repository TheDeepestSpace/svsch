import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, fitGraphView, openFixture, paddedAllNodesClip } from './helper';

// Regression coverage for #257 and #314. The repeated concat-LHS assignment
// should create each register once, then preserve the source-level aggregate
// through one mux per condition before a single final breakout.
test.describe('aggregate assignment branches visual rendering', () => {
  test('renders one aggregate priority-mux chain and one final breakout', async ({ page }) => {
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

    const breakouts = view.nodes.filter((node) => node.kind === 'bus' && node.label === 'breakout');
    expect(breakouts).toHaveLength(1);
    expect(view.nodes.filter((node) => node.kind === 'mux')).toHaveLength(3);

    for (const register of registers) {
      const dDrivers = view.edges.filter(
        (edge) => edge.target === register.id && edge.targetPort === 'd',
      );
      expect(dDrivers).toHaveLength(1);
      expect(dDrivers[0].source).toBe(breakouts[0].id);
    }

    expect(
      view.edges.filter(
        (edge) =>
          view.nodes.find((node) => node.id === edge.source)?.kind === 'mux' &&
          edge.target === breakouts[0].id,
      ),
    ).toHaveLength(1);

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
