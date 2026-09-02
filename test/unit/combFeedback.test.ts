import { describe, expect, it } from 'vitest';
import { runParser } from '../helper';
import { buildViewModel } from '../../src/layout/mergeLayout';
import type { DesignGraph } from '../../src/ir/types';

function combLoopDiagnostics(graph: DesignGraph) {
  return graph.diagnostics.filter((d) => d.message.includes('combinational feedback loop'));
}

describe('structural combinational feedback (uhdm)', () => {
  it('extracts a cross-coupled NAND SR latch as two gates with cyclic edges', async () => {
    const graph = await runParser(
      'uhdm',
      'sr.sv',
      `
      module top(input logic s_n, input logic r_n, output logic q, output logic qn);
        assign q  = ~(s_n & qn);
        assign qn = ~(r_n & q);
      endmodule
    `,
    );
    const module = graph.modules.top;
    const gates = module.nodes.filter((node) => node.kind === 'gate');
    expect(gates).toHaveLength(2);
    expect(gates.map((gate) => gate.metadata?.operation)).toEqual(['nand', 'nand']);

    // The cross-coupled wires form a genuine 2-cycle between the gates...
    const qGate = gates.find((gate) => gate.id.includes(':q:'))!;
    const qnGate = gates.find((gate) => gate.id.includes(':qn:'))!;
    const crossQ = module.edges.find((e) => e.source === qGate.id && e.target === qnGate.id)!;
    const crossQn = module.edges.find((e) => e.source === qnGate.id && e.target === qGate.id)!;
    expect(crossQ).toBeDefined();
    expect(crossQn).toBeDefined();

    // ...and only those two edges are flagged as combinational feedback.
    expect(crossQ.metadata?.combFeedback).toBe(true);
    expect(crossQn.metadata?.combFeedback).toBe(true);
    for (const edge of module.edges) {
      if (edge === crossQ || edge === crossQn) continue;
      expect(edge.metadata?.combFeedback).toBeUndefined();
    }

    const warnings = combLoopDiagnostics(graph);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('q, qn');
  });

  it('lays out the cyclic graph without dropping nodes or edges', async () => {
    const graph = await runParser(
      'uhdm',
      'sr.sv',
      `
      module top(input logic s_n, input logic r_n, output logic q, output logic qn);
        assign q  = ~(s_n & qn);
        assign qn = ~(r_n & q);
      endmodule
    `,
    );
    const view = await buildViewModel(graph, 'top', { version: 1, modules: {} });
    const gateViews = view.nodes.filter((node) => node.id.startsWith('gate:'));
    expect(gateViews).toHaveLength(2);
    // ELK's cycle breaking must place both gates and keep all six edges
    // (2 inputs, 2 outputs, 2 cross-coupled) rather than hanging or pruning.
    expect(view.edges).toHaveLength(6);
    const positions = new Set(gateViews.map((node) => `${node.position.x},${node.position.y}`));
    expect(positions.size).toBe(2);
  });

  it('flags a single comb node feeding itself (mux hold loop)', async () => {
    const graph = await runParser(
      'uhdm',
      'hold.sv',
      `
      module top(input logic en, input logic d, output logic q);
        assign q = en ? d : q;
      endmodule
    `,
    );
    const module = graph.modules.top;
    const selfFeedback = module.edges.filter((edge) => edge.metadata?.combFeedback);
    expect(selfFeedback.length).toBeGreaterThan(0);
    for (const edge of selfFeedback) {
      expect(edge.source).toBe(edge.target);
    }
    expect(combLoopDiagnostics(graph)).toHaveLength(1);
  });

  it('does not flag clocked feedback through a register', async () => {
    const graph = await runParser(
      'uhdm',
      'toggle.sv',
      `
      module top(input logic clk, output logic q);
        always_ff @(posedge clk) q <= ~q;
      endmodule
    `,
    );
    const module = graph.modules.top;
    expect(module.nodes.some((node) => node.kind === 'register')).toBe(true);
    expect(module.edges.some((edge) => edge.metadata?.combFeedback)).toBe(false);
    expect(combLoopDiagnostics(graph)).toHaveLength(0);
  });

  it('does not flag a behavioral (inferred-latch) SR latch', async () => {
    const graph = await runParser(
      'uhdm',
      'sr_behavioral.sv',
      `
      module top(input logic s, input logic r, output logic q);
        always_comb begin
          case ({s, r})
            2'b10: q = 1'b1;
            2'b01: q = 1'b0;
          endcase
        end
      endmodule
    `,
    );
    const module = graph.modules.top;
    expect(module.edges.some((edge) => edge.metadata?.combFeedback)).toBe(false);
    expect(combLoopDiagnostics(graph)).toHaveLength(0);
  });
});
