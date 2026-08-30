import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, fitGraphView, openFixture, paddedAllNodesClip } from './helper';

// Issue #265 / PR #347: a chain of the same logical operator (`a && b && c && d`,
// `a || b || c`) used to promote as nested 2-input gates instead of one flattened
// n-input gate, and a logical chain with comparator leaves (`(p == q) && r && (s
// == t)`) lost its flattening too. This renders logical_gate_chains.sv so the fix
// is covered as a diagram change, not just the IR assertions in
// test/unit/gate.test.ts.
test.describe('chained logical gate promotion visual', () => {
  test('flattens same-operator &&/|| chains and keeps mixed expressions opaque', async ({
    page,
  }) => {
    const view = await openFixture(page, 'logical_gate_chains.sv', 'auto');
    await fitGraphView(page, 0.1);

    const gateNodes = view.nodes.filter((node) => node.kind === 'gate');
    // and_chain (4-input AND), or_chain (3-input OR), mixed_comparators (3-input AND).
    expect(gateNodes).toHaveLength(3);

    const andChain = gateNodes.find((node) => node.id === 'gate:logical_gate_chains:and_chain:and');
    expect(andChain?.metadata?.operation).toBe('and');
    expect(
      andChain?.ports
        .filter((port) => port.direction === 'input')
        .map((port) => port.connectedSignal),
    ).toEqual(['a', 'b', 'c', 'd']);

    const orChain = gateNodes.find((node) => node.id === 'gate:logical_gate_chains:or_chain:or');
    expect(orChain?.metadata?.operation).toBe('or');
    expect(
      orChain?.ports
        .filter((port) => port.direction === 'input')
        .map((port) => port.connectedSignal),
    ).toEqual(['e', 'f', 'g']);

    const mixedGate = gateNodes.find(
      (node) => node.id === 'gate:logical_gate_chains:mixed_comparators:and',
    );
    expect(mixedGate?.metadata?.operation).toBe('and');
    expect(mixedGate?.ports.filter((port) => port.direction === 'input')).toHaveLength(3);

    // Comparator leaves inside the mixed chain stay their own nodes, not folded in.
    expect(view.nodes.filter((node) => node.kind === 'comparator')).toHaveLength(2);

    // The bitwise/logical fallback expression stays one opaque comb node.
    expect(view.nodes.filter((node) => node.kind === 'comb')).toHaveLength(1);

    await expect(page.locator('[data-node-kind="gate"]')).toHaveCount(3);
    await expect(page.locator('[data-node-kind="comparator"]')).toHaveCount(2);
    await expect(page.locator('[data-node-kind="comb"]')).toHaveCount(1);

    await expectGraphAndScreenshot(page, 'gate-chains-promotion.png', {
      clip: await paddedAllNodesClip(page),
    });
  });
});
