import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, fitGraphView, openFixture, paddedAllNodesClip } from './helper';

test.describe('nested case visual rendering', () => {
  test('renders sibling nested-case arms with identical labels as distinct literal nodes', async ({ page }) => {
    const view = await openFixture(page, 'nested_case_literal_collision.sv', 'auto', 'nested_case_literal_collision');

    const innerMuxes = view.nodes.filter((node) => (
      node.kind === 'mux' && node.ports.some((port) => port.name === 'sel' && port.connectedSignal === 'sel_inner')
    ));
    expect(innerMuxes).toHaveLength(2);

    // Each inner mux's 2'b01 arm must be driven by its own literal node
    // (4'hA vs 4'hB), not a shared node from whichever arm was elaborated first.
    const literalSignals = innerMuxes.map((mux) => mux.ports.find((port) => port.label === "2'b01")?.connectedSignal);
    expect(new Set(literalSignals).size).toBe(2);

    const literalLabels = literalSignals.map((signal) => (
      view.nodes.find((node) => node.kind === 'literal' && node.ports.some((port) => port.direction === 'output' && port.connectedSignal === signal))?.label
    ));
    expect(literalLabels.sort()).toEqual(["4'hA", "4'hB"]);

    await expect(page.locator('[data-node-kind="mux"]')).toHaveCount(3);
    await expect(page.locator('[data-node-kind="literal"] .svsch-literal-content', { hasText: "4'hA" })).toBeVisible();
    await expect(page.locator('[data-node-kind="literal"] .svsch-literal-content', { hasText: "4'hB" })).toBeVisible();

    await fitGraphView(page);
    await expectGraphAndScreenshot(page, 'nested-case-literal-collision-canvas.png', { clip: await paddedAllNodesClip(page) });
  });
});
