import { describe, expect, it } from 'vitest';
import { diagramSizing } from '../../src/diagram/constants';
import {
  distributedInterfaceSideCenters,
  interfaceSkinPath,
  interfaceTopHatBounds,
  interfaceTopHatHeight,
  interfaceTopHatTop,
  interfaceTopPortX,
  orderedInterfaceSidePorts
} from '../../src/diagram/interfaceGeometry';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';
import { interfaceInstanceTopHatY } from '../../src/diagram/visualHandleGeometry';
import type { DiagramNode, DiagramPort } from '../../src/ir/types';

describe('interface instance geometry', () => {
  it('orders side modports by source line while preserving preferred side', () => {
    const ports = [
      port('monitor', 'right', 30),
      port('controller', 'left', 40),
      port('producer', 'left', 10),
      port('consumer', 'right', 20)
    ];

    const ordered = orderedInterfaceSidePorts(ports);

    expect(ordered.left.map((p) => p.name)).toEqual(['producer', 'controller']);
    expect(ordered.right.map((p) => p.name)).toEqual(['consumer', 'monitor']);
  });

  it('distributes top ports along the top-hat and keeps side sockets one grid tall', () => {
    const width = diagramSizing.gridSize * 8;
    const topHat = interfaceTopHatBounds(width, 2);
    const topXs = [interfaceTopPortX(width, 2, 0), interfaceTopPortX(width, 2, 1)];
    const sideCenters = distributedInterfaceSideCenters(2, diagramSizing.gridSize * 8, interfaceTopHatHeight(true));

    expect(topHat.width).toBeGreaterThanOrEqual(diagramSizing.gridSize * 4);
    expect(topXs[0]).toBeGreaterThan(topHat.left);
    expect(topXs[1]).toBeLessThan(topHat.right);
    expect(topXs[1] - topXs[0]).toBeGreaterThanOrEqual(diagramSizing.gridSize);
    expect(sideCenters[1] - sideCenters[0]).toBe(diagramSizing.gridSize * 2);
    expect(sideCenters.every((center) => center % (diagramSizing.gridSize / 2) === 0)).toBe(true);
    expect(interfaceTopHatTop(sideCenters, interfaceTopHatHeight(true))).toBe(sideCenters[0] - diagramSizing.gridSize * 1.5);
  });

  it('uses the same cap width for top and bottom interface ports', () => {
    const width = diagramSizing.gridSize * 8;
    const topHat = interfaceTopHatBounds(width, 2, 2);
    const bottomHat = interfaceTopHatBounds(width, 1, 2);

    expect(bottomHat.width).toBe(topHat.width);
    expect(bottomHat.left).toBe(topHat.left);
    expect(interfaceTopPortX(width, 1, 0, 2)).toBe(width / 2);
  });

  it('keeps minimal all-one-side modports inside the interface body', () => {
    const grid = diagramSizing.gridSize;
    // Content-derived height: 1 grid corridor + hat + 3-grid row span.
    const height = grid * 5;
    const sideCenters = distributedInterfaceSideCenters(2, height, interfaceTopHatHeight(true));

    expect(sideCenters).toEqual([grid * 2.5, grid * 4.5]);
    // First notch top sits one grid below the hat; last notch bottom is flush.
    expect(sideCenters[0] - grid / 2).toBe(interfaceTopHatHeight(true) + grid);
    expect(sideCenters[1] + grid / 2).toBe(height);
  });

  it('reserves bottom cap space when interface outputs are present', () => {
    const grid = diagramSizing.gridSize;
    // Content-derived height: corridor + hat + rows + bottom cap.
    const height = grid * 6;
    const sideCenters = distributedInterfaceSideCenters(2, height, interfaceTopHatHeight(true), interfaceTopHatHeight(true));

    expect(sideCenters).toEqual([grid * 2.5, grid * 4.5]);
    expect(sideCenters[1] + grid / 2 + interfaceTopHatHeight(true)).toBe(height);
  });

  it('biases a single side modport down against the bottom cap', () => {
    const grid = diagramSizing.gridSize;
    const sideCenters = distributedInterfaceSideCenters(1, grid * 4, interfaceTopHatHeight(true), interfaceTopHatHeight(true));

    expect(sideCenters).toEqual([grid * 2.5]);
    expect(sideCenters[0] + grid / 2).toBe(grid * 3);
  });

  it('aligns interface top-hat with shifted side centers', () => {
    const grid = diagramSizing.gridSize;
    const shiftY = grid; // 24px
    const rawCenters = [84, 132];
    const shiftedCenters = rawCenters.map(c => c + shiftY);
    const topHatHeight = grid;
    const topHatTop = interfaceTopHatTop(shiftedCenters, topHatHeight);

    // sideTop = min(shiftedCenters) - grid / 2 = 108 - 12 = 96
    // topHatTop = sideTop - topHatHeight = 96 - 24 = 72
    expect(topHatTop).toBe(72);
    expect(topHatTop % (grid / 2)).toBe(0);
  });

  it('uses the rendered fallback top-hat position when no side modports exist', () => {
    const node: DiagramNode = {
      id: 'interface:caps_only:status',
      kind: 'interface',
      label: 'status',
      metadata: { role: 'breakout', typeName: 'caps_only_if' },
      ports: [
        { id: 'clk', name: 'clk', direction: 'input' },
        { id: 'done', name: 'done', direction: 'output' }
      ]
    };
    const { width, height } = diagramNodeDimensions(node);
    const rendered = interfaceSkinPath({
      width,
      height,
      leftCenters: [],
      rightCenters: [],
      topPortCount: 1,
      bottomPortCount: 1
    });

    expect(interfaceInstanceTopHatY(node, height)).toBe(rendered.topHatTop);
    expect(rendered.topHatTop).toBeGreaterThan(0);
  });
});

function port(name: string, preferredSide: 'left' | 'right', startLine: number): DiagramPort {
  return {
    id: name,
    name,
    direction: preferredSide === 'left' ? 'input' : 'output',
    width: 'interface',
    preferredSide,
    modportSource: { file: 'fixture.sv', startLine }
  };
}
