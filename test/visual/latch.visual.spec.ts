import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, fitGraphView, openFixture, paddedAllNodesClip } from './helper';

test.describe('latch visual rendering', () => {
  test('renders an S-R latch as a case-selected mux feeding an inferred latch', async ({
    page,
  }) => {
    const view = await openFixture(page, 'latch_sr.sv');
    const mux = view.nodes.find((node) => node.kind === 'mux');
    const latch = view.nodes.find((node) => node.kind === 'latch');

    expect(mux).toBeDefined();
    expect(latch).toBeDefined();
    expect(
      view.edges.some(
        (edge) => edge.source === mux?.id && edge.target === latch?.id && edge.targetPort === 'd',
      ),
    ).toBe(true);
    expect(
      view.edges.some((edge) => edge.source === latch?.id && edge.target === 'port:sr_latch:q'),
    ).toBe(true);

    await expect(page.locator('[data-node-kind="port"] >> text=s')).toBeVisible();
    await expect(page.locator('[data-node-kind="port"] >> text=r')).toBeVisible();
    await expect(page.locator('[data-node-kind="port"] >> text=q')).toBeVisible();
    await expect(page.locator('[data-node-kind="mux"]')).toBeVisible();
    await expect(page.locator('[data-node-kind="latch"]')).toBeVisible();
    await expect(page.locator(".svsch-mux-side-port >> text=2'b10")).toBeVisible();
    await expect(page.locator(".svsch-mux-side-port >> text=2'b01")).toBeVisible();

    await fitGraphView(page);
    await expectGraphAndScreenshot(page, 'latch-sr-canvas.png', {
      clip: await paddedAllNodesClip(page),
    });
  });

  test('renders a structural cross-coupled NAND SR latch with feedback edges', async ({ page }) => {
    const view = await openFixture(page, 'latch_sr_gate.sv');
    const gates = view.nodes.filter((node) => node.kind === 'gate');
    expect(gates).toHaveLength(2);

    // The cross-coupled wires survive layout as a genuine 2-cycle between the
    // two NAND gates instead of being dropped or collapsed.
    const qGate = gates.find((node) => node.id.includes(':q:'));
    const qnGate = gates.find((node) => node.id.includes(':qn:'));
    expect(qGate).toBeDefined();
    expect(qnGate).toBeDefined();
    expect(view.edges.some((edge) => edge.source === qGate?.id && edge.target === qnGate?.id)).toBe(
      true,
    );
    expect(view.edges.some((edge) => edge.source === qnGate?.id && edge.target === qGate?.id)).toBe(
      true,
    );

    await expect(page.locator('[data-node-kind="gate"]')).toHaveCount(2);
    await expect(page.locator('[data-node-kind="port"] >> text=s_n')).toBeVisible();
    await expect(page.locator('[data-node-kind="port"] >> text=r_n')).toBeVisible();

    await fitGraphView(page);
    await expectGraphAndScreenshot(page, 'latch-sr-gate-canvas.png', {
      clip: await paddedAllNodesClip(page),
    });
  });
});
