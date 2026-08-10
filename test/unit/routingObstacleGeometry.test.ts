import { describe, expect, it } from 'vitest';
import { diagramSizing } from '../../src/diagram/constants';
import type { DiagramNode } from '../../src/ir/types';
import { routingObstacleMargins } from '../../src/layout/routingObstacleGeometry';

function terminal(direction: 'input' | 'output'): DiagramNode {
  return {
    id: direction,
    kind: 'port',
    label: direction,
    ports: [{ id: direction, name: direction, direction }]
  };
}

describe('routing obstacle geometry', () => {
  it('reserves vertical snapping room and a trailing-side corridor for input terminals', () => {
    expect(routingObstacleMargins(terminal('input'), ['EAST'])).toEqual({
      left: diagramSizing.gridSize,
      right: 0,
      top: diagramSizing.gridSize / 2,
      bottom: diagramSizing.gridSize / 2
    });
  });

  it('mirrors the trailing-side corridor for output terminals', () => {
    expect(routingObstacleMargins(terminal('output'), ['WEST'])).toEqual({
      left: 0,
      right: diagramSizing.gridSize,
      top: diagramSizing.gridSize / 2,
      bottom: diagramSizing.gridSize / 2
    });
  });

  it('keeps a left-side and half-grid vertical corridor around literals', () => {
    const literal: DiagramNode = {
      id: 'literal',
      kind: 'literal',
      label: '1',
      ports: [{ id: 'out', name: 'out', direction: 'output' }]
    };

    expect(routingObstacleMargins(literal, ['EAST'])).toEqual({
      left: diagramSizing.gridSize,
      right: 0,
      top: diagramSizing.gridSize / 2,
      bottom: diagramSizing.gridSize / 2
    });
  });

  it('keeps one grid of routing clearance around cut-net ends', () => {
    const cutEnd: DiagramNode = {
      id: 'cut-label:clk:sink',
      kind: 'netLabel',
      label: 'clk',
      ports: [{ id: 'cut', name: 'cut', direction: 'output' }]
    };

    expect(routingObstacleMargins(cutEnd, ['EAST'])).toEqual({
      left: diagramSizing.gridSize,
      right: diagramSizing.gridSize,
      top: diagramSizing.gridSize,
      bottom: diagramSizing.gridSize
    });
  });
});
