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

function expectMuxSelector(module: DesignModule, mux: DiagramNode | undefined, signal: string): void {
  expect(mux).toBeDefined();
  const selectorPort = mux?.ports.find((port) => port.name === 'sel');
  expect(selectorPort).toBeDefined();
  expect(module.edges.some((edge) => (
    edge.source === `port:${module.name}:${signal}`
    && edge.target === mux?.id
    && edge.targetPort === selectorPort?.id
    && edge.signal === signal
  ))).toBe(true);
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
    expectMuxSelector(module, mux, 'sel');
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
    expectMuxSelector(module, outer, 'sel1');
    expectMuxSelector(module, inner, 'sel2');
    expect(module.edges.some((edge) => edge.source === inner?.id && edge.target === outer?.id)).toBe(true);
  });

  it('marks a whole-array ternary as a stacked mux', () => {
    const module = extract(`
      module top(
        input logic sel,
        input logic [7:0] a [0:1],
        input logic [7:0] b [0:1],
        output logic [7:0] y [0:1]
      );
        assign y = sel ? a : b;
      endmodule
    `);
    const mux = muxSelectedBy(module, 'sel');

    expect(mux?.isArrayNode ?? mux?.metadata?.isArrayNode).toBe(true);
    expect(mux?.arrayDimension ?? mux?.metadata?.arrayDimension).toBe('[0:1]');
    expect(mux?.arraySize ?? mux?.metadata?.arraySize).toBe(2);
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
    expectMuxSelector(module, mux, 'sel');
    expect(module.edges.some((edge) => edge.source === mux?.id && edge.target === comb?.id)).toBe(true);
  });

  it('falls back to a comb node when a ternary operand cannot be promoted', () => {
    const module = extract(`
      module top(input logic sel, a, output logic y);
        assign y = sel ? 1.5 : a;
      endmodule
    `);
    const comb = module.nodes.find((node) => node.kind === 'comb');

    expect(module.nodes.some((node) => node.kind === 'mux')).toBe(false);
    expect(comb?.metadata?.expression).toBe('sel ? 1.5 : a');
    expect(module.edges.some((edge) => edge.source === comb?.id && edge.target === 'port:top:y')).toBe(true);
  });

  it('ignores question-mark digits in sized literals when splitting a ternary', () => {
    const module = extract(`
      module top(input logic sel, a, b, output logic y);
        assign y = sel == 4'b1?01 ? a : b;
      endmodule
    `);
    const mux = module.nodes.find((node) => node.kind === 'mux');

    expect(module.nodes.filter((node) => node.kind === 'mux')).toHaveLength(1);
    expect(mux?.ports.find((port) => port.label === "1'b1")?.connectedSignal).toBe('a');
    expect(mux?.ports.find((port) => port.label === "1'b0")?.connectedSignal).toBe('b');
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

  it('does not mistake a scope-resolution operator for the ternary delimiter', () => {
    const module = extract(`
      module top(input logic sel, b, output logic y);
        assign y = sel ? pkg::value : b;
      endmodule
    `);
    const mux = muxSelectedBy(module, 'sel');
    const scopedArm = module.nodes.find((node) => (
      node.kind === 'comb' && node.metadata?.expression === 'pkg::value'
    ));

    expect(mux?.ports.find((port) => port.label === "1'b1")?.connectedSignal).toBe('y_true');
    expect(mux?.ports.find((port) => port.label === "1'b0")?.connectedSignal).toBe('b');
    expect(scopedArm).toBeDefined();
    expect(module.edges.some((edge) => (
      edge.source === scopedArm?.id
      && edge.target === mux?.id
      && edge.targetPort === 'in:true'
    ))).toBe(true);
  });
});
