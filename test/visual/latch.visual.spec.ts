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

  test('renders a structural cross-coupled NOR SR latch with feedback edges', async ({ page }) => {
    const view = await openFixture(page, 'latch_sr_gate_nor.sv');
    const gates = view.nodes.filter((node) => node.kind === 'gate');
    expect(gates).toHaveLength(2);

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
    await expect(page.locator('[data-node-kind="port"] >> text=s')).toBeVisible();
    await expect(page.locator('[data-node-kind="port"] >> text=r')).toBeVisible();

    await fitGraphView(page);
    await expectGraphAndScreenshot(page, 'latch-sr-gate-nor-canvas.png', {
      clip: await paddedAllNodesClip(page),
    });
  });

  test('renders a mux hold loop as a single node feeding back into itself', async ({ page }) => {
    const view = await openFixture(page, 'mux_hold_loop.sv');
    const mux = view.nodes.find((node) => node.kind === 'mux');
    expect(mux).toBeDefined();

    // The mux's own output loops back into one of its data inputs — a
    // single-node cycle rather than a multi-gate one.
    expect(view.edges.some((edge) => edge.source === mux?.id && edge.target === mux?.id)).toBe(
      true,
    );

    await expect(page.locator('[data-node-kind="mux"]')).toBeVisible();
    await expect(page.locator('[data-node-kind="port"] >> text=en')).toBeVisible();
    await expect(page.locator('[data-node-kind="port"] >> text=d')).toBeVisible();
    await expect(page.locator('[data-node-kind="port"] >> text=q')).toBeVisible();

    await fitGraphView(page);
    await expectGraphAndScreenshot(page, 'mux-hold-loop-canvas.png', {
      clip: await paddedAllNodesClip(page),
    });
  });

  test('renders a gated D-latch built from four cross-coupled NAND gates', async ({ page }) => {
    const view = await openFixture(page, 'latch_d_gated.sv');
    const gates = view.nodes.filter((node) => node.kind === 'gate');
    expect(gates).toHaveLength(4);

    // Only the q/qn pair closes a real cycle — the enable-decode gates
    // (s_n, r_n) feed into the loop but aren't part of it.
    const qGate = gates.find((node) => node.id.includes(':q:'));
    const qnGate = gates.find((node) => node.id.includes(':qn:'));
    const sNGate = gates.find((node) => node.id.includes(':s_n:'));
    const rNGate = gates.find((node) => node.id.includes(':r_n:'));
    expect(qGate).toBeDefined();
    expect(qnGate).toBeDefined();
    expect(sNGate).toBeDefined();
    expect(rNGate).toBeDefined();
    expect(view.edges.some((edge) => edge.source === qGate?.id && edge.target === qnGate?.id)).toBe(
      true,
    );
    expect(view.edges.some((edge) => edge.source === qnGate?.id && edge.target === qGate?.id)).toBe(
      true,
    );
    expect(
      view.edges.some((edge) => edge.source === sNGate?.id && edge.target === sNGate?.id),
    ).toBe(false);
    expect(
      view.edges.some((edge) => edge.source === rNGate?.id && edge.target === rNGate?.id),
    ).toBe(false);

    await expect(page.locator('[data-node-kind="gate"]')).toHaveCount(4);
    await expect(page.locator('[data-node-kind="port"] >> text=d')).toBeVisible();
    await expect(page.locator('[data-node-kind="port"] >> text=en')).toBeVisible();

    await fitGraphView(page);
    await expectGraphAndScreenshot(page, 'latch-d-gated-canvas.png', {
      clip: await paddedAllNodesClip(page),
    });
  });
});
