import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe.each(['uhdm'] as const)('ALU-style case arms: %s', (backend) => {
  it('renders each case arm as a dedicated block feeding the mux', async () => {
    const graph = await runParser(backend, 'alu_case_arms.sv', fixture('alu_case_arms.sv'));
    const mod = graph.modules.alu_case_arms;

    const muxes = mod.nodes.filter((node) => node.kind === 'mux');
    expect(muxes).toHaveLength(1);
    const mux = muxes[0];

    const aluNodes = mod.nodes.filter((node) => node.kind === 'alu');
    const gateNodes = mod.nodes.filter((node) => node.kind === 'gate');
    const comparatorNodes = mod.nodes.filter((node) => node.kind === 'comparator');
    const zextNodes = mod.nodes.filter((node) => node.kind === 'zext');
    const literalNodes = mod.nodes.filter((node) => node.kind === 'literal');

    // + and - each get a dedicated ALU node.
    expect(aluNodes).toHaveLength(2);
    expect(aluNodes.some((n) => n.metadata?.operation === '+')).toBe(true);
    expect(aluNodes.some((n) => n.metadata?.operation === '-')).toBe(true);

    // &, |, and && each get a dedicated gate node.
    expect(gateNodes).toHaveLength(3);
    expect(gateNodes.some((n) => n.metadata?.operation === '&')).toBe(true);
    expect(gateNodes.some((n) => n.metadata?.operation === '|')).toBe(true);
    expect(gateNodes.some((n) => n.metadata?.operation === '&&')).toBe(true);

    // && reduces to a single bit regardless of operand width, same as a comparator.
    const logicalGateNode = gateNodes.find((n) => n.metadata?.operation === '&&');
    const logicalGateOutput = logicalGateNode?.ports.find((p) => p.direction === 'output');
    expect(logicalGateOutput?.width).toBe('[0:0]');

    // < gets a dedicated comparator node with a 1-bit output.
    expect(comparatorNodes).toHaveLength(1);
    expect(comparatorNodes[0].metadata?.operation).toBe('<');
    const comparatorOutput = comparatorNodes[0].ports.find((p) => p.direction === 'output');
    expect(comparatorOutput?.width).toBe('[0:0]');

    // Both the comparator's and the logical gate's 1-bit outputs feed the wider
    // mux through explicit zext nodes.
    expect(zextNodes).toHaveLength(2);
    const zextForComparator = zextNodes.find((n) =>
      n.ports.find((p) => p.direction === 'input')?.connectedSignal === comparatorOutput?.connectedSignal);
    expect(zextForComparator).toBeDefined();
    const zextInput = zextForComparator!.ports.find((p) => p.direction === 'input');
    const zextOutput = zextForComparator!.ports.find((p) => p.direction === 'output');
    expect(zextInput?.connectedSignal).toBe(comparatorOutput?.connectedSignal);
    expect(zextInput?.width).toBe(comparatorOutput?.width);
    expect(zextOutput?.width).not.toBe(zextInput?.width);
    const muxOutput = mux.ports.find((p) => p.direction === 'output');
    expect(zextOutput?.width).toBe(muxOutput?.width);
    expect(mux.ports.some((p) => p.direction === 'input' && p.connectedSignal === zextOutput?.connectedSignal)).toBe(true);

    // default: result = '0 keeps rendering as its own constant-0 block.
    expect(literalNodes.length).toBeGreaterThan(0);
    expect(mux.ports.some((p) => p.label === 'default')).toBe(true);
  });
});
