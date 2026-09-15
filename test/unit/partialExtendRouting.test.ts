import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolvedNodeDimensions } from '../../src/diagram/nodeSizing';
import type { DiagramViewModel } from '../../src/ir/types';
import { setLibavoidRuntimeForTests } from '../../src/layout/libavoidRouter';
import { mergeNodePositions } from '../../src/layout/mergeLayout';
import {
  buildPartialViewModel,
  resolveExtendTarget,
  type PartialDiagramState,
} from '../../src/layout/partialDiagram';
import type { SavedLayout } from '../../src/storage/layoutStore';
import { runParser } from '../helper';

beforeAll(async () => {
  await AvoidLib.load();
  setLibavoidRuntimeForTests(AvoidLib.getInstance());
});

// The FSM from the "Rebuilding a whole FSM inside the partial" BDD scenario
// (PR #408). Replaying its extend-every-net sequence exercises the routing
// failure modes that used to leave wires slicing straight through node
// bodies mid-sequence: a cut label's obstacle margin swallowing a
// neighboring pin, and a multi-use literal registering several coincident
// libavoid pins (see libavoidRouter's clipMarginsAroundForeignPins and pin
// dedup for the fixes).
const FSM_SOURCE = `module top(input clk, input rst_n, input logic next_state_en, output logic [1:0] state);
  typedef enum logic [1:0] {IDLE=0, START=1, BUSY=2, DONE=3} state_t;
  state_t r, next_r;
  always_ff @(posedge clk or negedge rst_n) if(!rst_n) r <= IDLE; else r <= next_r;
  always_comb begin
    if (next_state_en) begin
      case (r)
        IDLE:    next_r = START;
        START:   next_r = BUSY;
        BUSY:    next_r = DONE;
        DONE:    next_r = IDLE;
        default: next_r = IDLE;
      endcase
    end
  end
  assign state = r;
endmodule
`;

function nodeBodyOverlaps(view: DiagramViewModel): string[] {
  const problems: string[] = [];
  const bodies = view.nodes.filter((node) => node.kind !== 'netLabel');
  for (const edge of view.edges) {
    const route = edge.routePoints;
    if (!route || route.length < 2) continue;
    for (const body of bodies) {
      const size = resolvedNodeDimensions(body);
      const hit = route.slice(1).some((point, index) => {
        const prev = route[index];
        return (
          Math.max(prev.x, point.x) > body.position.x &&
          Math.min(prev.x, point.x) < body.position.x + size.width &&
          Math.max(prev.y, point.y) > body.position.y &&
          Math.min(prev.y, point.y) < body.position.y + size.height
        );
      });
      if (hit) problems.push(`${edge.id} crosses ${body.id}`);
    }
  }
  return problems;
}

describe('partial diagram extend routing', () => {
  it('keeps every wire outside node bodies through a full FSM rebuild', async () => {
    const graph = await runParser('uhdm', 'top.sv', FSM_SOURCE);
    const module = graph.modules['top'];
    const regId = module.nodes.find((node) => node.kind === 'register')!.id;
    const state: PartialDiagramState = {
      sourceModuleName: 'top',
      includedNodeIds: [regId],
      tiedNetKeys: [],
    };
    let layout: SavedLayout = { version: 1, modules: {} };

    for (let step = 0; step < 40; step += 1) {
      const view = await buildPartialViewModel(module, state, layout);
      layout = mergeNodePositions(
        layout,
        'top',
        view.nodes.map((node) => ({
          ...node,
          fixed: node.kind === 'netLabel' ? node.fixed : true,
        })),
      );
      expect(nodeBodyOverlaps(view), `after extend #${step}`).toEqual([]);

      const label = view.nodes.find((node) => node.kind === 'netLabel');
      if (!label) break;
      const cut = label.metadata!.cutNet!;
      const target = resolveExtendTarget(module, state, cut.netKey, cut.originalEdgeId);
      expect(target, `extend target for ${cut.netKey}`).toBeDefined();
      state.includedNodeIds.push(...target!.newNodeIds);
      if (!state.tiedNetKeys.includes(cut.netKey)) state.tiedNetKeys.push(cut.netKey);
    }
  }, 240000);
});
