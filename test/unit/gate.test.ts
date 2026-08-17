import { describe, expect, it } from 'vitest';
import { runParser } from '../helper';
import type { DesignModule, DiagramNode } from '../../src/ir/types';

async function extract(text: string): Promise<DesignModule> {
  const graph = await runParser('uhdm', 'gate.sv', text);
  return graph.modules.top;
}

function gates(module: DesignModule): DiagramNode[] {
  return module.nodes.filter((node) => node.kind === 'gate');
}

describe('gate node extraction (uhdm)', () => {
  it.each([
    ['&', 'and'],
    ['|', 'or'],
    ['^', 'xor']
  ] as const)('promotes a %s b to a 2-input %s gate', async (op, expectedOp) => {
    const module = await extract(`
      module top(input logic a, input logic b, output logic y);
        assign y = a ${op} b;
      endmodule
    `);
    const gateNodes = gates(module);
    expect(gateNodes).toHaveLength(1);
    const gate = gateNodes[0];
    expect(gate.metadata?.operation).toBe(expectedOp);
    expect(gate.ports.filter((p) => p.direction === 'input').map((p) => p.connectedSignal)).toEqual(['a', 'b']);
    expect(gate.ports.find((p) => p.direction === 'output')?.connectedSignal).toBe('y');
    expect(module.edges.some((edge) => edge.source === 'port:top:a' && edge.target === gate.id)).toBe(true);
    expect(module.edges.some((edge) => edge.source === 'port:top:b' && edge.target === gate.id)).toBe(true);
    expect(module.edges.some((edge) => edge.source === gate.id && edge.target === 'port:top:y')).toBe(true);
  });

  it.each([
    ['~(a & b)', 'nand'],
    ['~(a | b)', 'nor'],
    ['~(a ^ b)', 'xnor']
  ] as const)('fuses %s into a single negated-output gate, not a separate inverter', async (expr, expectedOp) => {
    const module = await extract(`
      module top(input logic a, input logic b, output logic y);
        assign y = ${expr};
      endmodule
    `);
    expect(module.nodes.some((node) => node.kind === 'inverter')).toBe(false);
    const gateNodes = gates(module);
    expect(gateNodes).toHaveLength(1);
    expect(gateNodes[0].metadata?.operation).toBe(expectedOp);
    expect(gateNodes[0].ports.filter((p) => p.direction === 'input').map((p) => p.connectedSignal)).toEqual(['a', 'b']);
  });

  it.each([
    ['^~', 'a ^~ b'],
    ['~^', 'a ~^ b']
  ] as const)('promotes a source-level XNOR (%s) directly, same as the negation-fused form', async (_op, expr) => {
    const module = await extract(`
      module top(input logic a, input logic b, output logic y);
        assign y = ${expr};
      endmodule
    `);
    const gateNodes = gates(module);
    expect(gateNodes).toHaveLength(1);
    expect(gateNodes[0].metadata?.operation).toBe('xnor');
  });

  it('flattens a chain of the same operator into one n-ary gate (a & b & c & d -> one 4-input AND)', async () => {
    const module = await extract(`
      module top(input logic a, input logic b, input logic c, input logic d, output logic y);
        assign y = a & b & c & d;
      endmodule
    `);
    const gateNodes = gates(module);
    expect(gateNodes).toHaveLength(1);
    expect(gateNodes[0].metadata?.operation).toBe('and');
    expect(gateNodes[0].ports.filter((p) => p.direction === 'input').map((p) => p.connectedSignal)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('flattens a longer same-operator OR chain the same way', async () => {
    const module = await extract(`
      module top(input logic a, input logic b, input logic c, output logic y);
        assign y = a | b | c;
      endmodule
    `);
    const gateNodes = gates(module);
    expect(gateNodes).toHaveLength(1);
    expect(gateNodes[0].metadata?.operation).toBe('or');
    expect(gateNodes[0].ports.filter((p) => p.direction === 'input').map((p) => p.connectedSignal)).toEqual(['a', 'b', 'c']);
  });

  it('flattens a chain of the same operator into one n-ary gate (a ^ b ^ c -> one 3-input XOR)', async () => {
    const module = await extract(`
      module top(input logic a, input logic b, input logic c, output logic y);
        assign y = a ^ b ^ c;
      endmodule
    `);
    const gateNodes = gates(module);
    expect(gateNodes).toHaveLength(1);
    expect(gateNodes[0].metadata?.operation).toBe('xor');
    expect(gateNodes[0].ports.filter((p) => p.direction === 'input').map((p) => p.connectedSignal)).toEqual(['a', 'b', 'c']);
  });

  it('never flattens across operator types: (a|b)&c stays OR-feeding-AND, two separate gates', async () => {
    const module = await extract(`
      module top(input logic a, input logic b, input logic c, output logic y);
        assign y = (a | b) & c;
      endmodule
    `);
    const gateNodes = gates(module);
    expect(gateNodes).toHaveLength(2);
    const andGate = gateNodes.find((g) => g.metadata?.operation === 'and');
    const orGate = gateNodes.find((g) => g.metadata?.operation === 'or');
    expect(andGate).toBeDefined();
    expect(orGate).toBeDefined();
    expect(orGate?.ports.filter((p) => p.direction === 'input').map((p) => p.connectedSignal)).toEqual(['a', 'b']);
    const orOutput = orGate?.ports.find((p) => p.direction === 'output')?.connectedSignal;
    expect(andGate?.ports.filter((p) => p.direction === 'input').map((p) => p.connectedSignal)).toEqual([orOutput, 'c']);
    expect(module.edges.some((edge) => edge.source === orGate?.id && edge.target === andGate?.id)).toBe(true);
  });

  it('keeps plain unary bitwise negation as an inverter node, not a gate', async () => {
    const module = await extract(`
      module top(input logic a, output logic y);
        assign y = ~a;
      endmodule
    `);
    expect(gates(module)).toHaveLength(0);
    expect(module.nodes.some((node) => node.kind === 'inverter')).toBe(true);
  });
});
