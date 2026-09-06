import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('aggregate assignment issues', () => {
  it('lowers a repeated concat-LHS chain as one aggregate mux path', async () => {
    const graph = await runParser(
      'uhdm',
      'aggregate_assignment_branches.sv',
      fixture('aggregate_assignment_branches.sv'),
    );
    const mod = graph.modules.aggregate_assignment_branches;

    expect(mod).toBeDefined();

    const registerIds = ['data_reg', 'data_valid'].map((signal) => `reg:${mod.name}:${signal}`);
    for (const registerId of registerIds) {
      expect(mod.nodes.filter((node) => node.id === registerId)).toHaveLength(1);

      const dDrivers = mod.edges.filter(
        (edge) => edge.target === registerId && edge.targetPort === 'd',
      );
      expect(dDrivers).toHaveLength(1);
      expect(mod.nodes.find((node) => node.id === dDrivers[0].source)?.metadata?.expression).toBe(
        '[aggregate-breakout]',
      );

      const register = mod.nodes.find((node) => node.id === registerId);
      expect(register?.ports.some((port) => port.name === 'RV')).toBe(false);
    }

    const breakouts = mod.nodes.filter(
      (node) => node.kind === 'bus' && node.metadata?.expression === '[aggregate-breakout]',
    );
    expect(breakouts).toHaveLength(1);

    const muxes = mod.nodes.filter((node) => node.kind === 'mux');
    expect(muxes).toHaveLength(3);
    expect(
      mod.edges.filter(
        (edge) => muxes.some((mux) => mux.id === edge.source) && edge.target === breakouts[0].id,
      ),
    ).toHaveLength(1);
    expect(
      mod.edges.filter(
        (edge) =>
          muxes.some((mux) => mux.id === edge.source) &&
          muxes.some((mux) => mux.id === edge.target),
      ),
    ).toHaveLength(2);

    const holdCompose = mod.nodes.find(
      (node) =>
        node.metadata?.expression === '[aggregate-compose]' &&
        node.metadata?.reason === 'implicit aggregate hold',
    );
    expect(holdCompose).toBeDefined();
    for (const registerId of registerIds) {
      expect(
        mod.edges.some((edge) => edge.source === registerId && edge.target === holdCompose?.id),
      ).toBe(true);
    }
    expect(
      mod.edges.filter(
        (edge) => edge.source === holdCompose?.id && muxes.some((mux) => mux.id === edge.target),
      ),
    ).toHaveLength(1);
  });

  it('keeps per-target lowering for mixed aggregate and scalar arms', async () => {
    const graph = await runParser(
      'uhdm',
      'mixed_aggregate_scalar_branches.sv',
      `
module mixed_aggregate_scalar_branches (
  input logic clk,
  input logic sel,
  input logic [3:0] din,
  output logic [3:0] data,
  output logic valid
);
  always_ff @(posedge clk) begin
    if (sel)
      {data, valid} <= {din, 1'b1};
    else begin
      data <= 4'b0;
      valid <= 1'b0;
    end
  end
endmodule
`,
    );
    const mod = graph.modules.mixed_aggregate_scalar_branches;

    expect(mod.nodes.filter((node) => node.kind === 'mux')).toHaveLength(2);
    expect(
      mod.nodes.some(
        (node) =>
          node.metadata?.expression === '[aggregate-compose]' &&
          node.metadata?.reason === 'implicit aggregate hold',
      ),
    ).toBe(false);

    for (const signal of ['data', 'valid']) {
      const registerId = `reg:${mod.name}:${signal}`;
      const dDriver = mod.edges.find(
        (edge) => edge.target === registerId && edge.targetPort === 'd',
      );
      expect(mod.nodes.find((node) => node.id === dDriver?.source)?.kind).toBe('mux');
    }
  });

  it('connects aggregate breakouts into slice and struct composition nodes', async () => {
    const graph = await runParser(
      'uhdm',
      'aggregate_assignment_showcase.sv',
      fixture('aggregate_assignment_showcase.sv'),
    );
    const mod = graph.modules.aggregate_assignment_showcase;

    expect(mod).toBeDefined();

    const mirroredBreakout = mod.nodes.find(
      (n) =>
        n.kind === 'bus' &&
        n.metadata?.expression === '[aggregate-breakout]' &&
        n.ports.some((p) => p.connectedSignal === 'mirrored[7:4]'),
    );
    expect(mirroredBreakout).toBeDefined();

    const mirroredComp = mod.nodes.find((n) => n.id === `bus_comp:${mod.name}:mirrored`);
    expect(mirroredComp).toBeDefined();
    expect(
      mod.edges.some((e) => e.source === mirroredBreakout?.id && e.target === mirroredComp?.id),
    ).toBe(true);
    expect(
      mod.edges.some(
        (e) =>
          e.source === mirroredComp?.id &&
          e.target === 'port:aggregate_assignment_showcase:mirrored',
      ),
    ).toBe(true);

    const pktOComp = mod.nodes.find((n) => n.id === `struct_comp:${mod.name}:pkt_o`);
    expect(pktOComp).toBeDefined();
    const pktOBreakout = mod.nodes.find(
      (n) =>
        n.kind === 'bus' &&
        n.metadata?.expression === '[aggregate-breakout]' &&
        n.ports.some((p) => p.connectedSignal === 'pkt_o.lane'),
    );
    expect(pktOBreakout).toBeDefined();

    expect(
      mod.edges.some(
        (e) =>
          e.source === pktOBreakout?.id && e.target === pktOComp?.id && e.signal === 'pkt_o.opcode',
      ),
    ).toBe(true);
    expect(
      mod.edges.some(
        (e) =>
          e.source === pktOBreakout?.id && e.target === pktOComp?.id && e.signal === 'pkt_o.valid',
      ),
    ).toBe(true);
    expect(
      mod.edges.some(
        (e) =>
          e.source === pktOBreakout?.id && e.target === pktOComp?.id && e.signal === 'pkt_o.lane',
      ),
    ).toBe(true);
  });

  it('correctly handles nested concatenations and replications', async () => {
    const graph = await runParser(
      'uhdm',
      'aggregate_assignment_showcase.sv',
      fixture('aggregate_assignment_showcase.sv'),
    );
    const mod = graph.modules.aggregate_assignment_showcase;

    const breakout = mod.nodes.find(
      (n) =>
        n.kind === 'bus' &&
        n.metadata?.expression === '[aggregate-breakout]' &&
        n.ports.some((p) => p.connectedSignal === 'mirrored[7:4]'),
    );
    const edgesToBreakout = mod.edges.filter((e) => e.target === breakout?.id);
    const composeId = edgesToBreakout.find((e) => e.targetPort === 'in:in')?.source;
    const compose = mod.nodes.find((n) => n.id === composeId);

    expect(compose).toBeDefined();

    // 1. Should NOT have a zero pad if sizes match (8 bits)
    const padPort = compose?.ports.find((p) => p.name === 'rhs_pad');
    expect(padPort).toBeUndefined();
    expect(compose?.ports.filter((p) => p.direction === 'input')).toHaveLength(2);

    // Find replicate node for 'd'
    const replicateNode = mod.nodes.find(
      (n) => n.kind === 'replicate' && n.ports.some((p) => p.connectedSignal === 'd'),
    );
    expect(replicateNode).toBeDefined();
    expect(replicateNode?.ports.find((p) => p.direction === 'output')?.width).toBe('[3:0]');

    expect(mod.edges.some((e) => e.source === replicateNode?.id && e.target === compose?.id)).toBe(
      true,
    );
    const innerEdge = mod.edges.find(
      (e) => e.target === compose?.id && e.source !== replicateNode?.id,
    );
    const innerCompose = mod.nodes.find((n) => n.id === innerEdge?.source);
    expect(innerCompose).toBeDefined();
    expect(innerCompose?.kind).toBe('bus');
    expect(innerCompose?.ports.some((p) => p.connectedSignal === 'opcode_lo')).toBe(true);
    expect(innerCompose?.ports.some((p) => p.connectedSignal === 'opcode_hi')).toBe(true);

    // 3. Check port indices on outer compose
    // Should be [7:4] for replicate and [3:0] for inner compose
    const repEdge = mod.edges.find(
      (e) => e.source === replicateNode?.id && e.target === compose?.id,
    );

    expect(compose?.ports.find((p) => p.id === repEdge?.targetPort)?.label).toBe('[7:4]');
    expect(compose?.ports.find((p) => p.id === innerEdge?.targetPort)?.label).toBe('[3:0]');
    expect(compose?.ports.find((p) => p.id === repEdge?.targetPort)?.width).toBe('[3:0]');
    expect(compose?.ports.find((p) => p.id === innerEdge?.targetPort)?.width).toBe('[3:0]');
  });

  it('labels procedural aggregate breakout slices by their aggregate bit ranges', async () => {
    const graph = await runParser(
      'uhdm',
      'aggregate_assignment_showcase.sv',
      fixture('aggregate_assignment_showcase.sv'),
    );
    const mod = graph.modules.aggregate_assignment_showcase;

    const breakout = mod.nodes.find(
      (n) =>
        n.kind === 'bus' &&
        n.metadata?.expression === '[aggregate-breakout]' &&
        n.ports.some((p) => p.connectedSignal === 'registered[2]_next'),
    );

    expect(breakout).toBeDefined();
    expect(breakout?.ports.find((p) => p.connectedSignal === 'registered[2]_next')).toMatchObject({
      label: '[2]',
      width: '[0:0]',
    });
    expect(breakout?.ports.find((p) => p.connectedSignal === 'registered[1:0]_next')).toMatchObject(
      { label: '[1:0]', width: '[1:0]' },
    );
    expect(breakout?.ports.find((p) => p.direction === 'input')).toMatchObject({ width: '[2:0]' });
  });
});
