import { describe, expect, it } from 'vitest';
import { compareEdgePaintOrder } from '../../src/diagram/edgePaintOrder';
import type { DiagramEdge } from '../../src/ir/types';

function edge(id: string, generateActiveState?: 'active' | 'inactive'): DiagramEdge {
  return {
    id,
    source: 's',
    target: 't',
    metadata: generateActiveState ? { generateActiveState } : undefined,
  } as DiagramEdge;
}

describe('compareEdgePaintOrder', () => {
  it('paints inactive edges below unknown, and active edges on top', () => {
    const sorted = [
      edge('a', 'active'),
      edge('b'),
      edge('c', 'inactive'),
      edge('d', 'active'),
      edge('e', 'inactive'),
    ].sort(compareEdgePaintOrder);

    expect(sorted.map((item) => item.id)).toEqual(['c', 'e', 'b', 'a', 'd']);
  });

  it('keeps stable id order within the same state', () => {
    const sorted = [edge('z', 'inactive'), edge('a', 'inactive')].sort(compareEdgePaintOrder);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'z']);
  });
});
