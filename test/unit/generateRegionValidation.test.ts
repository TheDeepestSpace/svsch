import { describe, expect, it } from 'vitest';
import type { PositionedGenerateRegion, PositionedNode } from '../../src/ir/types';
import {
  annotateGenerateRegionWarnings,
  GENERATE_REGION_EXTERNAL_NODE_WARNING,
  GENERATE_REGION_OVERLAP_WARNING
} from '../../src/layout/generateRegionValidation';

describe('generate region validation', () => {
  it('marks both sibling arms when their bounds overlap', () => {
    const regions = annotateGenerateRegionWarnings([
      region('g0', { x: 0, y: 0, width: 120, height: 120 }, ['n0']),
      region('g1', { x: 80, y: 40, width: 120, height: 120 }, ['n1'])
    ], [
      node('n0', 24, 24),
      node('n1', 120, 80)
    ]);

    expect(regions).toEqual([
      expect.objectContaining({
        id: 'g0',
        invalid: true,
        warningNote: GENERATE_REGION_OVERLAP_WARNING
      }),
      expect.objectContaining({
        id: 'g1',
        invalid: true,
        warningNote: GENERATE_REGION_OVERLAP_WARNING
      })
    ]);
  });

  it('marks an arm when it contains a node from outside the arm', () => {
    const [regionWithExternalNode] = annotateGenerateRegionWarnings([
      region('g0', { x: 0, y: 0, width: 160, height: 160 }, ['owned'])
    ], [
      node('owned', 24, 24),
      node('external', 72, 72)
    ]);

    expect(regionWithExternalNode).toEqual(expect.objectContaining({
      invalid: true,
      warningNote: GENERATE_REGION_EXTERNAL_NODE_WARNING
    }));
  });

  it('does not mark an arm for external ports or descendant arms', () => {
    const regions = annotateGenerateRegionWarnings([
      region('parent', { x: 0, y: 0, width: 240, height: 240 }, ['parent-node']),
      region('child', { x: 48, y: 48, width: 120, height: 120 }, ['child-node'], 'parent')
    ], [
      node('parent-node', 24, 24),
      node('child-node', 72, 72),
      node('external-port', 96, 96, 'port')
    ]);

    expect(regions.every((item) => !item.invalid && !item.warningNote)).toBe(true);
  });
});

function region(
  id: string,
  bounds: PositionedGenerateRegion['bounds'],
  nodeIds: string[],
  parentRegionId?: string
): PositionedGenerateRegion {
  return {
    id,
    kind: 'if',
    label: id,
    nodeIds,
    bounds,
    parentRegionId
  };
}

function node(
  id: string,
  x: number,
  y: number,
  kind: PositionedNode['kind'] = 'literal'
): PositionedNode {
  return {
    id,
    kind,
    label: id,
    ports: [],
    position: { x, y }
  } as PositionedNode;
}
