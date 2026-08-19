import { describe, expect, it } from 'vitest';
import type { PositionedGenerateRegion, PositionedNode } from '../../src/ir/types';
import {
  annotateGenerateRegionWarnings,
  findExternalBlockIds,
  GENERATE_REGION_EXTERNAL_NODE_WARNING,
  GENERATE_REGION_OVERLAP_WARNING,
} from '../../src/layout/generateRegionValidation';

describe('generate region validation', () => {
  it('marks both sibling arms when their bounds overlap', () => {
    const regions = annotateGenerateRegionWarnings(
      [
        region('g0', { x: 0, y: 0, width: 120, height: 120 }, ['n0']),
        region('g1', { x: 80, y: 40, width: 120, height: 120 }, ['n1']),
      ],
      [node('n0', 24, 24), node('n1', 120, 80)],
    );

    expect(regions).toEqual([
      expect.objectContaining({
        id: 'g0',
        invalid: true,
        warningNote: GENERATE_REGION_OVERLAP_WARNING,
      }),
      expect.objectContaining({
        id: 'g1',
        invalid: true,
        warningNote: GENERATE_REGION_OVERLAP_WARNING,
      }),
    ]);
  });

  it('marks an arm when it contains a node from outside the arm', () => {
    const [regionWithExternalNode] = annotateGenerateRegionWarnings(
      [region('g0', { x: 0, y: 0, width: 160, height: 160 }, ['owned'])],
      [node('owned', 24, 24), node('external', 72, 72)],
    );

    expect(regionWithExternalNode).toEqual(
      expect.objectContaining({
        invalid: true,
        warningNote: GENERATE_REGION_EXTERNAL_NODE_WARNING,
      }),
    );
  });

  it('marks an arm when an external node partially overlaps its bounds', () => {
    const [regionWithExternalNode] = annotateGenerateRegionWarnings(
      [region('g0', { x: 120, y: 120, width: 160, height: 160 }, ['owned'])],
      [
        node('owned', 144, 144),
        // The node overlaps the arm by one grid cell at the top edge, but its
        // center is outside the arm. This is the case users can see on canvas.
        node('external', 144, 48, 'instance'),
      ],
    );

    expect(regionWithExternalNode).toEqual(
      expect.objectContaining({
        invalid: true,
        warningNote: GENERATE_REGION_EXTERNAL_NODE_WARNING,
      }),
    );
  });

  it('does not mark an arm for its own descendant arms', () => {
    const regions = annotateGenerateRegionWarnings(
      [
        region('parent', { x: 0, y: 0, width: 240, height: 240 }, ['parent-node']),
        region('child', { x: 48, y: 48, width: 120, height: 120 }, ['child-node'], 'parent'),
      ],
      [node('parent-node', 24, 24), node('child-node', 72, 72)],
    );

    expect(regions.every((item) => !item.invalid && !item.warningNote)).toBe(true);
  });

  it('marks an arm when an unrelated module port is dragged into its bounds', () => {
    const [regionWithExternalPort] = annotateGenerateRegionWarnings(
      [region('g0', { x: 0, y: 0, width: 240, height: 240 }, ['owned'])],
      [node('owned', 24, 24), node('external-port', 96, 96, 'port')],
    );

    expect(regionWithExternalPort).toEqual(
      expect.objectContaining({
        invalid: true,
        warningNote: GENERATE_REGION_EXTERNAL_NODE_WARNING,
      }),
    );
    expect([
      ...findExternalBlockIds(
        [regionWithExternalPort],
        [node('owned', 24, 24), node('external-port', 96, 96, 'port')],
      ),
    ]).toEqual(['external-port']);
  });

  it('does not treat a cut-net label as an external block', () => {
    const nodes = [node('owned', 24, 24), node('cut-label', 96, 96, 'netLabel')];
    const [validated] = annotateGenerateRegionWarnings(
      [region('g0', { x: 0, y: 0, width: 240, height: 240 }, ['owned'])],
      nodes,
    );

    expect(validated.invalid).toBeUndefined();
    expect(findExternalBlockIds([validated], nodes)).toEqual(new Set());
  });

  it('does not flag a generate-block wrapper for its own arms or their blocks', () => {
    const regions = annotateGenerateRegionWarnings(
      [
        region('wrap', { x: 0, y: 0, width: 240, height: 240 }, []),
        region('arm0', { x: 20, y: 20, width: 90, height: 90 }, ['n0'], 'wrap'),
        region('arm1', { x: 130, y: 20, width: 90, height: 90 }, ['n1'], 'wrap'),
      ],
      [node('n0', 40, 40), node('n1', 150, 40)],
    );

    expect(regions.every((item) => !item.invalid)).toBe(true);
  });

  it('flags both generate-block wrappers when they overlap', () => {
    const regions = annotateGenerateRegionWarnings(
      [
        region('wrap-a', { x: 0, y: 0, width: 200, height: 200 }, []),
        region('arm-a', { x: 40, y: 40, width: 90, height: 90 }, ['na'], 'wrap-a'),
        region('wrap-b', { x: 180, y: 0, width: 200, height: 200 }, []),
        region('arm-b', { x: 220, y: 40, width: 90, height: 90 }, ['nb'], 'wrap-b'),
      ],
      [node('na', 60, 60), node('nb', 240, 60)],
    );

    const byId = new Map(regions.map((r) => [r.id, r]));
    expect(byId.get('wrap-a')).toEqual(
      expect.objectContaining({ invalid: true, warningNote: GENERATE_REGION_OVERLAP_WARNING }),
    );
    expect(byId.get('wrap-b')).toEqual(
      expect.objectContaining({ invalid: true, warningNote: GENERATE_REGION_OVERLAP_WARNING }),
    );
  });

  it('flags a generate-block wrapper and the unrelated block inside it', () => {
    const nodes = [node('owned', 60, 60), node('stray', 160, 160, 'instance')];
    const regions = annotateGenerateRegionWarnings(
      [
        region('wrap', { x: 0, y: 0, width: 240, height: 240 }, []),
        region('arm', { x: 40, y: 40, width: 90, height: 90 }, ['owned'], 'wrap'),
      ],
      nodes,
    );

    expect(regions.find((r) => r.id === 'wrap')).toEqual(
      expect.objectContaining({
        invalid: true,
        warningNote: GENERATE_REGION_EXTERNAL_NODE_WARNING,
      }),
    );
    expect([...findExternalBlockIds(regions, nodes)]).toEqual(['stray']);
  });
});

function region(
  id: string,
  bounds: PositionedGenerateRegion['bounds'],
  nodeIds: string[],
  parentRegionId?: string,
): PositionedGenerateRegion {
  return {
    id,
    kind: 'if',
    label: id,
    nodeIds,
    bounds,
    parentRegionId,
  };
}

function node(
  id: string,
  x: number,
  y: number,
  kind: PositionedNode['kind'] = 'literal',
): PositionedNode {
  return {
    id,
    kind,
    label: id,
    ports: [],
    position: { x, y },
  } as PositionedNode;
}
