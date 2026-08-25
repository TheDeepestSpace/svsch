import { describe, expect, it } from 'vitest';
import {
  moveRouteSegment,
  normalizeRoutePoints,
  avoidFeedbackObstacles,
  clampPointsToRect,
  type NodeObstacle,
} from '../../src/webview/orthogonal/logic';
import { HdlPosition } from '../../src/webview/orthogonal/types';
import { diagramSizing } from '../../src/diagram/constants';

describe('orthogonal edge routing', () => {
  it('recomputes protected lead points when connected nodes move', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 148, y: 10 },
          { x: 240, y: 10 },
          { x: 240, y: 90 },
          { x: 352, y: 90 },
        ],
      },
      192,
      48,
      408,
      168,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(route[0]).toEqual({ x: 192 + diagramSizing.edgeLeadLength, y: 48 });
    expect(route[route.length - 1]).toEqual({ x: 408 - diagramSizing.edgeLeadLength, y: 168 });
  });

  it('uses grid-aligned lead lengths from the shared diagram sizing', () => {
    const route = normalizeRoutePoints(
      undefined,
      96,
      48,
      408,
      48,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(route[0].x - 96).toBe(diagramSizing.edgeLeadLength);
    expect(408 - route[route.length - 1].x).toBe(diagramSizing.edgeLeadLength);
    expect(diagramSizing.edgeLeadLength % diagramSizing.gridSize).toBe(0);
  });

  // eslint-disable-next-line max-len
  it('draws a flat, straight segment for two ports level with each other even when their shared Y is not itself grid-aligned', () => {
    // A port's connection point is node-top + half its own height, which
    // doesn't have to land on a full grid line (e.g. 52, not a multiple of
    // the 24px grid). A fresh default route (no persisted routePoints or
    // waypoint) must not re-snap its own internal bends independently of
    // its endpoints — that previously opened a spurious few-pixel notch
    // in what should render as one flat horizontal line.
    const route = normalizeRoutePoints(
      undefined,
      120,
      52,
      360,
      52,
      HdlPosition.Right,
      HdlPosition.Left,
    );
    expect(route.every((point) => point.y === 52)).toBe(true);
  });

  it('keeps the real port lead before a displaced cut-stub bend', () => {
    const sourceNode = {
      id: 'u1',
      kind: 'instance' as const,
      label: 'u1',
      ports: [{ id: 'y', name: 'y', direction: 'output' as const }],
    };
    const targetNode = {
      id: 'cut-label:u1:y:source',
      kind: 'netLabel' as const,
      label: 'u1.y',
      ports: [{ id: 'cut', name: 'cut', direction: 'input' as const }],
    };
    const route = normalizeRoutePoints(
      {
        edge: {
          id: 'cut-stub:u1:y:source',
          source: sourceNode.id,
          sourcePort: 'y',
          target: targetNode.id,
          targetPort: 'cut',
          metadata: {
            forceStraight: true,
            cutStub: { netKey: 'u1:y', role: 'source' as const },
          },
        },
      },
      552,
      72,
      576,
      120,
      HdlPosition.Right,
      HdlPosition.Left,
      'y',
      'cut',
      true,
      sourceNode,
      targetNode,
    );

    expect(route).toEqual([
      { x: 576, y: 72 },
      { x: 576, y: 120 },
    ]);
  });

  it('does not loop an aligned cut stub between a label and a real input port', () => {
    const sourceNode = {
      id: 'cut-label:o:sink',
      kind: 'netLabel' as const,
      label: 'o',
      ports: [{ id: 'cut', name: 'cut', direction: 'output' as const }],
    };
    const targetNode = {
      id: 'o',
      kind: 'port' as const,
      label: 'o',
      ports: [{ id: 'port:o', name: 'o', direction: 'output' as const }],
    };
    const route = normalizeRoutePoints(
      {
        edge: {
          id: 'cut-stub:o:sink',
          source: sourceNode.id,
          sourcePort: 'cut',
          target: targetNode.id,
          targetPort: 'port:o',
          metadata: {
            forceStraight: true,
            cutStub: { netKey: 'o', role: 'sink' as const },
          },
        },
      },
      384,
      48,
      408,
      48,
      HdlPosition.Right,
      HdlPosition.Left,
      'cut',
      'port:o',
      true,
      sourceNode,
      targetNode,
    );

    expect(route).toEqual([{ x: 384, y: 48 }]);
  });

  it('keeps horizontal leads on the route grid from one-grid-tall block handles', () => {
    const sourceY = diagramSizing.gridSize;
    const targetY = diagramSizing.gridSize * 5;
    const route = normalizeRoutePoints(
      undefined,
      120,
      sourceY,
      360,
      targetY,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(route[0]).toEqual({ x: 120 + diagramSizing.edgeLeadLength, y: sourceY });
    expect(route[route.length - 1]).toEqual({ x: 360 - diagramSizing.edgeLeadLength, y: targetY });
    expect(route[0].y % diagramSizing.gridSize).toBe(0);
    expect(route[route.length - 1].y % diagramSizing.gridSize).toBe(0);
  });

  it('preserves off-grid side-port approach axes while snapping bends', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 216, y: 204 },
          { x: 333, y: 204 },
          { x: 333, y: 60 },
          { x: 456, y: 60 },
        ],
      },
      192,
      204,
      480,
      60,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(route).toEqual([
      { x: 216, y: 204 },
      { x: 336, y: 204 },
      { x: 336, y: 60 },
      { x: 456, y: 60 },
    ]);
  });

  it('preserves feedback turns at side-port lead points', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 1416, y: 120 },
          { x: 1416, y: 24 },
          { x: 24, y: 24 },
          { x: 24, y: 168 },
        ],
      },
      1392,
      120,
      48,
      168,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(route).toEqual([
      { x: 1416, y: 120 },
      { x: 1416, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: 168 },
    ]);
  });

  it('keeps the regular one-grid source lead for top-hat feeds', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 456, y: 0 },
          { x: 480, y: 0 },
          { x: 480, y: 168 },
        ],
      },
      456,
      0,
      480,
      180,
      HdlPosition.Right,
      HdlPosition.Top,
    );

    expect(route[0]).toEqual({ x: 480, y: 0 });
    expect(route.every((point) => point.x === 480)).toBe(true);
  });

  // eslint-disable-next-line max-len
  it('routes straight, not as a wrap-around loop, when the two leads land on exactly the same point', () => {
    // Endpoints exactly two lead lengths apart — e.g. an expanded instance's
    // border coming to rest one lead-pair short of the neighboring port. A
    // straight run fits exactly; treating this as feedback drew a loop that
    // doubled back through the target node.
    const sourceX = 720;
    const y = 72;
    const probe = normalizeRoutePoints(
      undefined,
      sourceX,
      y,
      sourceX + 480,
      y,
      HdlPosition.Right,
      HdlPosition.Left,
    );
    const lead = probe[0].x - sourceX;
    const targetX = sourceX + 2 * lead;

    const route = normalizeRoutePoints(
      undefined,
      sourceX,
      y,
      targetX,
      y,
      HdlPosition.Right,
      HdlPosition.Left,
    );
    expect(route.every((point) => point.y === y)).toBe(true);
    expect(route.every((point) => point.x >= sourceX && point.x <= targetX)).toBe(true);
  });

  it('routes feedback edges around the target instead of straight through the nodes', () => {
    const route = normalizeRoutePoints(
      undefined,
      420,
      120,
      260,
      120,
      HdlPosition.Right,
      HdlPosition.Left,
    );
    const sourceLead = route[0];
    const targetLead = route[route.length - 1];

    expect(sourceLead).toEqual({ x: 456, y: 120 });
    expect(targetLead).toEqual({ x: 240, y: 120 });
    expect(route.some((point) => point.y !== 120)).toBe(true);
    expect(route.some((point) => point.x > sourceLead.x)).toBe(true);
    expect(
      route.every(
        (point) => point.x % diagramSizing.gridSize === 0 && point.y % diagramSizing.gridSize === 0,
      ),
    ).toBe(true);
  });

  it('preserves edited feedback routes when lead constraints point through each other', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 456, y: 120 },
          { x: 528, y: 120 },
          { x: 528, y: 216 },
          { x: 240, y: 216 },
          { x: 240, y: 120 },
        ],
      },
      420,
      120,
      260,
      120,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(route).toContainEqual({ x: 528, y: 120 });
    expect(route).toContainEqual({ x: 528, y: 216 });
    expect(route).toContainEqual({ x: 240, y: 216 });
  });

  it('preserves source-side vertical edits on right-to-top feedback routes', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 1032, y: 816 },
          { x: 1128, y: 816 },
          { x: 1128, y: 384 },
          { x: 288, y: 384 },
          { x: 288, y: 432 },
        ],
      },
      1008,
      816,
      288,
      480,
      HdlPosition.Right,
      HdlPosition.Top,
      'q',
      'sel',
    );

    expect(route).toContainEqual({ x: 1032, y: 816 });
    expect(route).toContainEqual({ x: 1128, y: 816 });
    expect(route).toContainEqual({ x: 1128, y: 384 });
    expect(route).toContainEqual({ x: 288, y: 384 });
  });

  it('preserves committed full-point edits on right-to-top feedback routes', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 1008, y: 816 },
          { x: 1032, y: 816 },
          { x: 1128, y: 816 },
          { x: 1128, y: 384 },
          { x: 288, y: 384 },
          { x: 288, y: 432 },
          { x: 288, y: 480 },
        ],
      },
      1008,
      816,
      288,
      480,
      HdlPosition.Right,
      HdlPosition.Top,
      'q',
      'sel',
    );

    expect(route).toContainEqual({ x: 1032, y: 816 });
    expect(route).toContainEqual({ x: 1128, y: 816 });
    expect(route).toContainEqual({ x: 1128, y: 384 });
    expect(route).toContainEqual({ x: 288, y: 384 });
  });

  it('keeps every route segment orthogonal after stale points are normalized', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 148, y: 10 },
          { x: 240, y: 10 },
          { x: 260, y: 130 },
          { x: 352, y: 90 },
        ],
      },
      200,
      40,
      400,
      160,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    for (let index = 0; index < route.length - 1; index += 1) {
      const current = route[index];
      const next = route[index + 1];
      expect(current.x === next.x || current.y === next.y).toBe(true);
    }
  });

  it('keeps the dragged segment editable after a tiny pointer movement', () => {
    const points = [
      { x: 100, y: 100 },
      { x: 148, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 352, y: 200 },
      { x: 400, y: 200 },
    ];

    const { points: moved } = moveRouteSegment(points, 2, { x: 201, y: 130 });

    expect(moved.length).toBe(points.length);
    expect(moved[2].x).toBe(192);
    expect(moved[3].x).toBe(192);
    expect(moved[2].y).toBe(moved[1].y);
    expect(moved[3].y).toBe(moved[4].y);
  });

  it('normalizes routes to grid-aligned editable segments after connected nodes move', () => {
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 369, y: 94 },
          { x: 474, y: 94 },
          { x: 474, y: 143 },
          { x: 553, y: 143 },
        ],
      },
      288,
      96,
      625,
      168,
      HdlPosition.Right,
      HdlPosition.Left,
    );
    const points = [{ x: 288, y: 96 }, ...route, { x: 625, y: 168 }];
    const editableSegments = points.slice(0, -1).filter((point, index) => {
      const next = points[index + 1];
      const isEditable = index > 0 && index < points.length - 2;
      return isEditable && (point.x === next.x || point.y === next.y);
    });

    expect(
      route.every(
        (point) => point.x % diagramSizing.gridSize === 0 && point.y % diagramSizing.gridSize === 0,
      ),
    ).toBe(true);
    expect(editableSegments.length).toBeGreaterThan(0);
  });

  it('snaps moved segment coordinates to the grid', () => {
    const points = [
      { x: 96, y: 96 },
      { x: 168, y: 96 },
      { x: 240, y: 96 },
      { x: 240, y: 192 },
      { x: 336, y: 192 },
      { x: 408, y: 192 },
    ];

    const { points: moved } = moveRouteSegment(points, 2, { x: 251, y: 130 });

    expect(moved[2].x % diagramSizing.gridSize).toBe(0);
    expect(moved[3].x % diagramSizing.gridSize).toBe(0);
  });

  it('lands top mux selector leads back on the grid', () => {
    const route = normalizeRoutePoints(
      undefined,
      96,
      48,
      288,
      103,
      HdlPosition.Right,
      HdlPosition.Top,
    );
    const targetLead = route[route.length - 1];

    expect(targetLead.x).toBe(288);
    expect(targetLead.y % diagramSizing.gridSize).toBe(0);
    expect(targetLead.y).toBeLessThan(103);
  });

  it('uses a two-grid lead for reset handles on the bottom', () => {
    const route = normalizeRoutePoints(
      undefined,
      312,
      120,
      312,
      216,
      HdlPosition.Bottom,
      HdlPosition.Bottom,
      'q',
      'reset',
    );
    const sourceLead = route[0];
    const targetLead = route[route.length - 1];

    expect(sourceLead.y).toBe(120 + diagramSizing.gridSize * 2);
    expect(targetLead.y).toBe(216 + diagramSizing.gridSize);
  });

  it('routes input-port reset signals directly below the register reset handle', () => {
    const route = normalizeRoutePoints(
      undefined,
      168,
      792,
      456,
      576,
      HdlPosition.Right,
      HdlPosition.Bottom,
      'rst_n',
      'reset',
    );
    const sourceLead = route[0];
    const targetLead = route[route.length - 1];

    expect(sourceLead).toEqual({ x: 168 + diagramSizing.edgeLeadLength, y: 792 });
    expect(targetLead).toEqual({ x: 456, y: 576 + diagramSizing.gridSize });
    expect(route).toContainEqual({ x: targetLead.x, y: sourceLead.y });
    expect(route.slice(1, -1).every((point) => point.x === targetLead.x)).toBe(true);
  });

  it('uses a two-grid lead for mux selector handles on the top', () => {
    const route = normalizeRoutePoints(
      undefined,
      288,
      100,
      288,
      48,
      HdlPosition.Top,
      HdlPosition.Top,
      'sel',
      'out',
    );
    const sourceLead = route[0];
    const targetLead = route[route.length - 1];

    expect(sourceLead.y).toBe(48);
    expect(targetLead.y).toBe(48 - diagramSizing.gridSize * 2);
  });

  // eslint-disable-next-line max-len
  it('preserves the lead distance even when internal points are moved behind the lead point', () => {
    // Port at (96, 96), Right position, Lead at (120, 96)
    // Internal points: (100, 96), (100, 192), (432, 192)
    const route = normalizeRoutePoints(
      {
        routePoints: [
          { x: 120, y: 96 },
          { x: 100, y: 96 }, // Moved behind lead
          { x: 100, y: 192 },
          { x: 432, y: 192 },
        ],
      },
      96,
      96,
      456,
      192,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    // route[0] is the Lead point: (120, 96)
    expect(route[0]).toEqual({ x: 120, y: 96 });
    // route[1] is the next point.
    // The internal points (100, 96) and (100, 192) are both clamped to X=120.
    // Result of clamping: [(120, 96), (120, 96), (120, 192), (432, 192)]
    // Duplicates are removed.
    // Result: [(120, 96), (120, 192), (432, 192)]
    expect(route[1]).toEqual({ x: 120, y: 192 });
  });

  it('allows moving the middle vertical segment of a 3-segment route', () => {
    // 3-segment route (excluding leads): H -> V -> H
    // Full points: [Source, SourceLead, P1, P2, TargetLead, Target]
    const points = [
      { x: 100, y: 100 }, // Source
      { x: 124, y: 100 }, // SourceLead (Segment 0)
      { x: 200, y: 100 }, // P1 (Segment 1: Horizontal)
      { x: 200, y: 300 }, // P2 (Segment 2: Vertical - THE DRAGGED ONE)
      { x: 376, y: 300 }, // TargetLead (Segment 3: Horizontal)
      { x: 400, y: 300 }, // Target (Segment 4)
    ];

    // Drag vertical segment (index 2) to X=250
    const { points: moved } = moveRouteSegment(points, 2, { x: 250, y: 150 });

    // The vertical segment is between points[2] and points[3].
    // Both should have their X coordinate updated to the snapped pointer (240).
    expect(moved[2].x).toBe(240);
    expect(moved[3].x).toBe(240);

    // Orthogonality check
    expect(moved[2].y).toBe(moved[1].y); // Horizontal segment 1 preserved
    expect(moved[3].y).toBe(moved[4].y); // Horizontal segment 3 preserved
  });
});

describe('avoidFeedbackObstacles', () => {
  const obstacles: NodeObstacle[] = [
    { id: 'A', x: 100, y: 0, width: 100, height: 48 },
    { id: 'B', x: 100, y: 200, width: 100, height: 48 },
  ];

  it('preserves a manually dragged clear route for Right-to-Left feedback', () => {
    const sourceLead = { x: 224, y: 24 };
    const targetLead = { x: 76, y: 224 };

    const draggedPoints = [
      sourceLead,
      { x: 300, y: 24 },
      { x: 300, y: 300 },
      { x: 76, y: 300 },
      targetLead,
    ];

    const result = avoidFeedbackObstacles(
      draggedPoints,
      obstacles,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(result).toEqual(draggedPoints);
  });

  it('preserves a manually dragged clear route that goes to the LEFT', () => {
    const sourceLead = { x: 224, y: 24 };
    const targetLead = { x: 76, y: 224 };

    const draggedPoints = [
      sourceLead,
      { x: 224, y: -24 },
      { x: 0, y: -24 },
      { x: 0, y: 300 },
      { x: 76, y: 300 },
      targetLead,
    ];

    const result = avoidFeedbackObstacles(
      draggedPoints,
      obstacles,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(result).toEqual(draggedPoints);
  });

  it('overwrites a route that is NOT clear', () => {
    const sourceLead = { x: 224, y: 24 };
    const targetLead = { x: 76, y: 224 };

    const blockedPoints = [sourceLead, { x: 224, y: 224 }, targetLead];

    const result = avoidFeedbackObstacles(
      blockedPoints,
      obstacles,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(result).not.toEqual(blockedPoints);
    expect(result[result.length - 2].y).toBeGreaterThan(248);
  });

  it('preserves a complex bypass where no single segment spans the obstacles', () => {
    const sourceLead = { x: 224, y: 24 };
    const targetLead = { x: 76, y: 224 };

    const complexPoints = [
      sourceLead,
      { x: 250, y: 24 },
      { x: 250, y: 300 },
      { x: 150, y: 300 },
      { x: 150, y: 400 },
      { x: 50, y: 400 },
      { x: 50, y: 224 },
      targetLead,
    ];

    const result = avoidFeedbackObstacles(
      complexPoints,
      obstacles,
      HdlPosition.Right,
      HdlPosition.Left,
    );

    expect(result).toEqual(complexPoints);
  });

  it('overwrites a default zig-zag route that hits nodes', () => {
    const sourceLead = { x: 224, y: 24 };
    const targetLead = { x: 76, y: 224 };

    const zigZag = [sourceLead, { x: 150, y: 24 }, { x: 150, y: 224 }, targetLead];

    const result = avoidFeedbackObstacles(zigZag, obstacles, HdlPosition.Right, HdlPosition.Left);

    expect(result).not.toEqual(zigZag);
    expect(result[result.length - 2].y).toBeGreaterThan(248);
  });
});

describe('clampPointsToRect', () => {
  // The frame of an expanded instance ("Expand instance in place", #232):
  // internal spliced wires must never escape it.
  const frame = { x: 0, y: 0, width: 480, height: 360 };
  const insets = { top: 24, right: 6, bottom: 6, left: 6 };

  it('clamps a feedback loop that would swing outside the frame back inside', () => {
    const loop = [
      { x: 400, y: 100 },
      { x: 552, y: 100 }, // 72px past the right border
      { x: 552, y: 420 }, // 60px below the bottom border
      { x: 80, y: 420 },
      { x: 80, y: 200 },
    ];
    const clamped = clampPointsToRect(loop, frame, insets);
    for (const point of clamped) {
      expect(point.x).toBeGreaterThanOrEqual(frame.x + insets.left);
      expect(point.x).toBeLessThanOrEqual(frame.x + frame.width - insets.right);
      expect(point.y).toBeGreaterThanOrEqual(frame.y + insets.top);
      expect(point.y).toBeLessThanOrEqual(frame.y + frame.height - insets.bottom);
    }
    // Per-coordinate clamping is monotone, so the route stays orthogonal.
    for (let i = 1; i < clamped.length; i += 1) {
      const dx = Math.abs(clamped[i].x - clamped[i - 1].x);
      const dy = Math.abs(clamped[i].y - clamped[i - 1].y);
      expect(Math.min(dx, dy)).toBeLessThan(0.5);
    }
  });

  it('keeps the wire below the header strip (top inset)', () => {
    const points = [
      { x: 100, y: 60 },
      { x: 100, y: 4 }, // would strike through the node title
      { x: 300, y: 4 },
      { x: 300, y: 60 },
    ];
    const clamped = clampPointsToRect(points, frame, insets);
    expect(Math.min(...clamped.map((p) => p.y))).toBe(insets.top);
  });

  it('returns an in-frame route unchanged', () => {
    const points = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 220 },
      { x: 400, y: 220 },
    ];
    expect(clampPointsToRect(points, frame, insets)).toEqual(points);
  });

  it('is a no-op when the insets do not leave any interior', () => {
    const tiny = { x: 0, y: 0, width: 10, height: 10 };
    const points = [
      { x: -20, y: 5 },
      { x: 40, y: 5 },
    ];
    expect(clampPointsToRect(points, tiny, insets)).toEqual(points);
  });
});
