import { describe, expect, it } from 'vitest';
import type { PositionedGenerateRegion, PositionedNode } from '../../src/ir/types';
import {
  applyActiveSplices,
  EXPAND_GHOST_CLASS,
  type ActiveSplice,
} from '../../src/webview/expand/expandOverlay';
import type { HdlFlowNode } from '../../src/webview/nodes/types';

const insets = { top: 20, left: 30, right: 30, bottom: 10 };

function makeSplice(
  nodes: PositionedNode[],
  nestedRegions: PositionedGenerateRegion[] = [],
): ActiveSplice {
  const region: PositionedGenerateRegion = {
    id: 'expand:region::u_mid',
    kind: 'expand',
    label: 'u_mid : mid',
    nodeIds: nodes.map((node) => node.id),
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    expandedInstance: { instanceId: 'u_mid', childModuleName: 'mid', parentModuleName: 'top' },
  };
  return {
    namespace: 'u_mid',
    flowInstanceId: 'u_mid',
    parentModuleName: 'top',
    instanceId: 'u_mid',
    childModuleName: 'mid',
    topLevel: true,
    anchorInstancePosition: { x: 0, y: 0 },
    region,
    nodes,
    edges: [],
    contentInsets: insets,
    expandedSize: { width: 400, height: 300 },
    boundaryNodeIdByChildPortName: new Map(),
    nestedRegions,
  };
}

const instanceFlowNode: HdlFlowNode = {
  id: 'u_mid',
  type: 'hdl',
  position: { x: 0, y: 0 },
  data: {
    node: {
      id: 'u_mid',
      kind: 'instance',
      label: 'u_mid',
      moduleName: 'mid',
      ports: [],
      position: { x: 0, y: 0 },
    },
    moduleName: 'top',
    arrayConnections: [],
  },
};

describe('applyActiveSplices (nested inheritance)', () => {
  it('renders a spliced node stamped with metadata.expandGhost as a dimmed frame', () => {
    const nestedGhost: PositionedNode = {
      id: 'expand:u_mid::u_leaf',
      kind: 'instance',
      label: 'u_leaf',
      moduleName: 'leaf',
      ports: [],
      sizeOverride: { width: 10, height: 8 },
      metadata: { expandGhost: { insets } },
      position: { x: 60, y: 40 },
    };
    const plainContent: PositionedNode = {
      id: 'expand:u_mid::expand:u_leaf::lcomb',
      kind: 'comb',
      label: 'lcomb',
      ports: [],
      position: { x: 80, y: 60 },
    };
    const splices = new Map([['u_mid', makeSplice([nestedGhost, plainContent])]]);

    const { nodes } = applyActiveSplices([instanceFlowNode], [], [], splices, 'top');

    const ghostFlow = nodes.find((node) => node.id === 'expand:u_mid::u_leaf')!;
    expect(ghostFlow.className).toBe(EXPAND_GHOST_CLASS);
    expect(ghostFlow.data.expandContentInsets).toEqual(insets);
    expect(ghostFlow.draggable).toBe(false);

    const plainFlow = nodes.find((node) => node.id === 'expand:u_mid::expand:u_leaf::lcomb')!;
    expect(plainFlow.className).toBeUndefined();
    expect(plainFlow.data.expandContentInsets).toBeUndefined();
    // The nested frame layers as a backdrop below its own spliced content,
    // same as a live top-level ghost.
    expect(ghostFlow.zIndex).toBeLessThan(plainFlow.zIndex!);
  });

  it("surfaces a nested splice's own region so it gets a minimap outline too", () => {
    const nestedGhost: PositionedNode = {
      id: 'expand:u_mid::u_leaf',
      kind: 'instance',
      label: 'u_leaf',
      moduleName: 'leaf',
      ports: [],
      sizeOverride: { width: 10, height: 8 },
      metadata: { expandGhost: { insets } },
      position: { x: 60, y: 40 },
    };
    const nestedRegion: PositionedGenerateRegion = {
      id: 'expand:region::u_mid::expand:region::u_leaf',
      kind: 'expand',
      label: 'u_leaf : leaf',
      nodeIds: ['expand:u_mid::expand:u_leaf::lcomb'],
      bounds: { x: 60, y: 40, width: 120, height: 90 },
      expandedInstance: { instanceId: 'u_leaf', childModuleName: 'leaf', parentModuleName: 'mid' },
    };
    const splices = new Map([['u_mid', makeSplice([nestedGhost], [nestedRegion])]]);

    const atRest = applyActiveSplices([instanceFlowNode], [], [], splices, 'top');
    expect(atRest.regions).toContainEqual(nestedRegion);

    // Dragging the outer instance rigidly translates its own region *and*
    // the nested region riding along inside it, by the same delta.
    const movedInstance: HdlFlowNode = {
      ...instanceFlowNode,
      position: { x: 25, y: 15 },
    };
    const moved = applyActiveSplices([movedInstance], [], [], splices, 'top');
    const movedNested = moved.regions.find((region) => region.id === nestedRegion.id)!;
    expect(movedNested.bounds).toEqual({ x: 85, y: 55, width: 120, height: 90 });
  });
});
