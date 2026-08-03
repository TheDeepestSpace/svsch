import { describe, expect, it } from 'vitest';
import { extractDesignFromText } from '../../src/parser/textExtractor';
import type { DesignModule, DiagramNode } from '../../src/ir/types';

function extract(text: string): DesignModule {
  return extractDesignFromText([{ file: 'top.sv', text }]).modules.top;
}

function muxSelectedBy(module: DesignModule, selector: string): DiagramNode | undefined {
  return module.nodes.find((node) => (
    node.kind === 'mux'
    && node.ports.some((port) => port.name === 'sel' && port.connectedSignal === selector)
  ));
}

describe('text fallback ternary extraction', () => {
  it('emits a mux with bit-literal arm labels', () => {
    const module = extract(`
      module top(
        input logic sel,
        input logic a,
        input logic b,
        output logic y
      );
        assign y = sel ? a : b;
      endmodule
    `);
    const mux = muxSelectedBy(module, 'sel');

    expect(module.nodes.filter((node) => node.kind === 'mux')).toHaveLength(1);
    expect(module.nodes.some((node) => node.kind === 'comb')).toBe(false);
    expect(mux?.ports.find((port) => port.label === "1'b1")?.connectedSignal).toBe('a');
    expect(mux?.ports.find((port) => port.label === "1'b0")?.connectedSignal).toBe('b');
    expect(mux?.ports.find((port) => port.direction === 'output')?.name).toBe('out');
    expect(module.edges.some((edge) => edge.source === 'port:top:a' && edge.target === mux?.id)).toBe(true);
    expect(module.edges.some((edge) => edge.source === 'port:top:b' && edge.target === mux?.id)).toBe(true);
    expect(module.edges.some((edge) => edge.source === mux?.id && edge.target === 'port:top:y')).toBe(true);
  });

  it('recursively emits nested ternaries as cascaded muxes', () => {
    const module = extract(`
      module top(
        input logic sel1,
        input logic sel2,
        input logic a,
        input logic b,
        input logic c,
        output logic y
      );
        assign y = sel1 ? (sel2 ? a : b) : c;
      endmodule
    `);
    const outer = muxSelectedBy(module, 'sel1');
    const inner = muxSelectedBy(module, 'sel2');

    expect(module.nodes.filter((node) => node.kind === 'mux')).toHaveLength(2);
    expect(module.edges.some((edge) => edge.source === inner?.id && edge.target === outer?.id)).toBe(true);
  });

  it('extracts a parenthesized ternary from a larger expression', () => {
    const module = extract(`
      module top(
        input logic sel,
        input logic a,
        input logic b,
        input logic c,
        output logic y
      );
        assign y = a + (sel ? b : c);
      endmodule
    `);
    const mux = muxSelectedBy(module, 'sel');
    const comb = module.nodes.find((node) => node.kind === 'comb');

    expect(mux).toBeDefined();
    expect(comb).toBeDefined();
    expect(comb?.ports.some((port) => port.direction === 'input' && port.name === 'y_ternary_0')).toBe(true);
    expect(comb?.ports.some((port) => port.direction === 'input' && ['sel', 'b', 'c'].includes(port.name))).toBe(false);
    expect(module.edges.some((edge) => edge.source === mux?.id && edge.target === comb?.id)).toBe(true);
  });

  it('does not mistake a part-select colon for a ternary', () => {
    const module = extract(`
      module top(
        input logic [3:0] bus,
        output logic [1:0] y
      );
        assign y = bus[3:2];
      endmodule
    `);

    expect(module.nodes.some((node) => node.kind === 'mux')).toBe(false);
  });
});
