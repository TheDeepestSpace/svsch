import { describe, expect, it } from 'vitest';
import { spliceExpandedInstance, childNamespace, namespacedId, expandRegionId, isExpandNamespacedId } from '../../src/webview/expand/splice';
import type { DesignModule, DiagramPort } from '../../src/ir/types';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';

// A tiny two-port-plus-register module, standing in for the child module
// being spliced in when its instance is "Expand"ed in place (issue #232).
const clkPort: DiagramPort = { id: 'p:clk', name: 'clk', direction: 'input' };
const aPort: DiagramPort = { id: 'p:a', name: 'a', direction: 'input' };
const sumPort: DiagramPort = { id: 'p:sum', name: 'sum', direction: 'output' };

const childModule: DesignModule = {
  name: 'adder',
  file: 'adder.sv',
  ports: [clkPort, aPort, sumPort],
  nodes: [
    { id: 'port:clk', kind: 'port', label: 'clk', ports: [clkPort] },
    { id: 'port:a', kind: 'port', label: 'a', ports: [aPort] },
    { id: 'port:sum', kind: 'port', label: 'sum', ports: [sumPort] },
    { id: 'reg1', kind: 'register', label: 'reg1', ports: [{ id: 'd', name: 'd', direction: 'input' }, { id: 'q', name: 'q', direction: 'output' }] }
  ],
  edges: [
    { id: 'e-clk-reg1', source: 'port:clk', target: 'reg1', sourcePort: 'p:clk', targetPort: 'clk' },
    { id: 'e-a-reg1', source: 'port:a', target: 'reg1', sourcePort: 'p:a', targetPort: 'd' },
    { id: 'e-reg1-sum', source: 'reg1', target: 'port:sum', sourcePort: 'q', targetPort: 'p:sum' }
  ]
};

const instancePosition = { x: 240, y: 120 };
const instanceSize = { width: 192, height: 96 };
// Instance ports mirror the module's own port list (same names/ids) — the
// contract splice.ts relies on to match an instance port to the child's own
// port-kind node.
const instancePorts: DiagramPort[] = [clkPort, aPort, sumPort];

function baseInput() {
  return {
    namespace: 'u0',
    parentModuleName: 'top',
    instanceId: 'u0',
    instanceLabel: 'u0',
    instancePosition,
    instanceSize,
    instanceParamRows: 0,
    instancePorts,
    childModule
  };
}

describe('spliceExpandedInstance', () => {
  it('replaces the child module\'s own port nodes with namespaced boundary-port nodes anchored to the instance\'s port positions', async () => {
    const result = await spliceExpandedInstance(baseInput());

    const boundaryNodes = result.nodes.filter((n) => n.kind === 'boundaryPort');
    expect(boundaryNodes).toHaveLength(3);
    for (const node of boundaryNodes) {
      expect(isExpandNamespacedId(node.id)).toBe(true);
    }

    const clkBoundaryId = result.boundaryNodeIdByChildPortName.get('clk');
    const sumBoundaryId = result.boundaryNodeIdByChildPortName.get('sum');
    expect(clkBoundaryId).toBe(namespacedId('u0', 'port:clk'));
    expect(sumBoundaryId).toBe(namespacedId('u0', 'port:sum'));

    const clkNode = result.nodes.find((n) => n.id === clkBoundaryId)!;
    const sumNode = result.nodes.find((n) => n.id === sumBoundaryId)!;
    // Input port -> boundary node's outer (left) edge sits exactly at the
    // instance's own left edge, so the pre-existing external wire (which
    // already terminates there) needs no route change at all.
    expect(clkNode.metadata?.boundaryPort?.outerSide).toBe('left');
    expect(clkNode.position.x).toBe(instancePosition.x);
    // Output port -> boundary node's outer (right) edge sits at the
    // instance's right edge.
    expect(sumNode.metadata?.boundaryPort?.outerSide).toBe('right');
    expect(sumNode.position.x + diagramNodeDimensions(sumNode).width)
      .toBe(instancePosition.x + instanceSize.width);
  });

  it('lays out the child\'s internal (non-port) nodes via elkjs, namespaced under the instance', async () => {
    const result = await spliceExpandedInstance(baseInput());

    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'));
    expect(reg).toBeDefined();
    expect(reg?.kind).toBe('register');
    expect(Number.isFinite(reg?.position.x)).toBe(true);
    expect(Number.isFinite(reg?.position.y)).toBe(true);
  });

  it('rewires internal edges onto the namespaced nodes, pointing a former child-port endpoint at the boundary node\'s inner handle', async () => {
    const result = await spliceExpandedInstance(baseInput());

    const clkEdge = result.edges.find((e) => e.id === namespacedId('u0', 'e-clk-reg1'));
    expect(clkEdge).toBeDefined();
    expect(clkEdge?.source).toBe(namespacedId('u0', 'port:clk'));
    expect(clkEdge?.sourcePort).toBe('inner');
    expect(clkEdge?.target).toBe(namespacedId('u0', 'reg1'));
    expect(clkEdge?.targetPort).toBe('clk'); // untouched — real node ports aren't namespaced
    // No stale absolute-coordinate route carried over from the child's own
    // standalone layout — OrthogonalEdge derives a fresh default route from
    // the real (live) handle positions when none is supplied.
    expect(clkEdge?.routePoints).toBeUndefined();
    expect(clkEdge?.waypoint).toBeUndefined();

    const sumEdge = result.edges.find((e) => e.id === namespacedId('u0', 'e-reg1-sum'));
    expect(sumEdge?.source).toBe(namespacedId('u0', 'reg1'));
    expect(sumEdge?.target).toBe(namespacedId('u0', 'port:sum'));
    expect(sumEdge?.targetPort).toBe('inner');
  });

  it('produces a region shaped like the rest of the region overlay machinery, sized to contain every spliced node', async () => {
    const result = await spliceExpandedInstance(baseInput());

    expect(result.region.id).toBe(expandRegionId('u0'));
    expect(result.region.kind).toBe('expand');
    expect(result.region.expandedInstance).toEqual({ instanceId: 'u0', childModuleName: 'adder', parentModuleName: 'top' });
    expect(new Set(result.region.nodeIds)).toEqual(new Set(result.nodes.map((n) => n.id)));
    expect(result.region.bounds.width).toBeGreaterThan(0);
    expect(result.region.bounds.height).toBeGreaterThan(0);
  });

  it('round-trips through toSavedLayout keyed by the child module\'s own (unnamespaced) node ids, boundary nodes excluded', async () => {
    const result = await spliceExpandedInstance(baseInput());
    const saved = result.toSavedLayout(result.nodes, result.region.bounds, true, instancePosition);

    expect(saved.childModuleName).toBe('adder');
    expect(Object.keys(saved.nodes)).toEqual(['reg1']);
    expect(saved.instanceOrigin).toEqual(instancePosition);
    expect(saved.fixed).toBe(true);
  });

  it('reuses a saved snapshot verbatim when the instance hasn\'t moved since it was saved', async () => {
    const savedLayout = {
      childModuleName: 'adder',
      nodes: { reg1: { x: 999, y: 111, fixed: true } },
      instanceOrigin: instancePosition
    };
    const result = await spliceExpandedInstance({ ...baseInput(), savedLayout });
    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'));
    expect(reg?.position).toEqual({ x: 999, y: 111 });
  });

  it('rigidly translates a saved snapshot when the instance has moved since it was saved', async () => {
    const savedLayout = {
      childModuleName: 'adder',
      nodes: { reg1: { x: 100, y: 50, fixed: true } },
      instanceOrigin: { x: 0, y: 0 }
    };
    // Instance is now at (240, 120) — 240 right, 120 down from where it was
    // when this snapshot was saved.
    const result = await spliceExpandedInstance({ ...baseInput(), savedLayout });
    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'));
    expect(reg?.position).toEqual({ x: 340, y: 170 });
  });

  it('namespaces recursively for a nested Expand (expand-of-an-expanded-instance)', async () => {
    const nestedNamespace = childNamespace('u0', 'u1');
    expect(nestedNamespace).toBe('u0::u1');
    const result = await spliceExpandedInstance({ ...baseInput(), namespace: nestedNamespace, parentModuleName: 'adder', instanceId: 'u1', parentRegionId: expandRegionId('u0') });
    expect(result.region.parentRegionId).toBe(expandRegionId('u0'));
    expect(result.nodes.every((n) => n.id.startsWith(namespacedId(nestedNamespace, '')))).toBe(true);
  });
});
