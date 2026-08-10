import { describe, expect, test } from 'vitest';
import { diagramSizing } from '../../src/diagram/constants';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';
import { gateInputPortCenterY, muxInputPortCenterY } from '../../src/diagram/muxGeometry';
import type { DiagramNode } from '../../src/ir/types';

const grid = diagramSizing.gridSize;

function gateOfInputCount(count: number): DiagramNode {
  return {
    id: `node:gate${count}`,
    kind: 'gate',
    label: '',
    metadata: { operation: 'and' },
    ports: [
      ...Array.from({ length: count }, (_, i) => ({ id: `in${i}`, name: `in${i}`, direction: 'input' as const })),
      { id: 'out', name: 'out', direction: 'output' as const }
    ]
  };
}

describe('gateInputPortCenterY', () => {
  test('2-input gate ports sit one full grid line apart, matching the ALU', () => {
    const { height } = diagramNodeDimensions(gateOfInputCount(2));
    const ys = [0, 1].map((i) => gateInputPortCenterY(i, 2, height));
    expect(ys).toEqual([grid, grid * 3]);
    expect(ys[0]).toBe(grid);
    expect(height - ys[1]).toBe(grid);
  });

  test('3-input gate (e.g. NAND) insets its first/last port by exactly one grid unit', () => {
    const { height } = diagramNodeDimensions(gateOfInputCount(3));
    const ys = [0, 1, 2].map((i) => gateInputPortCenterY(i, 3, height));
    expect(ys[0]).toBe(grid);
    expect(height - ys[ys.length - 1]).toBe(grid);
  });

  test('falls back to the centered mux spacing once the one-grid-apart layout would overflow the body', () => {
    const { height } = diagramNodeDimensions(gateOfInputCount(4));
    for (let i = 0; i < 4; i++) {
      expect(gateInputPortCenterY(i, 4, height)).toBe(muxInputPortCenterY(i, 4, height));
    }
  });
});
