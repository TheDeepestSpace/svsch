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

    // &, |, &&, and || each get a dedicated gate node. Bitwise `&`/`|` and logical
    // `&&`/`||` render as the same AND/OR glyph (metadata.operation "and"/"or");
    // they're told apart below by output width, since only the logical ones
    // reduce to 1 bit.
    expect(gateNodes).toHaveLength(4);
    const andGateNodes = gateNodes.filter((n) => n.metadata?.operation === 'and');
    const orGateNodes = gateNodes.filter((n) => n.metadata?.operation === 'or');
    expect(andGateNodes).toHaveLength(2);
    expect(orGateNodes).toHaveLength(2);

    // && and || each reduce to a single bit regardless of operand width, same as
    // a comparator.
    const logicalAndGateNode = andGateNodes.find(
      (n) => n.ports.find((p) => p.direction === 'output')?.width === '[0:0]',
    );
    const logicalAndGateOutput = logicalAndGateNode?.ports.find((p) => p.direction === 'output');
    expect(logicalAndGateOutput?.width).toBe('[0:0]');

    const logicalOrGateNode = orGateNodes.find(
      (n) => n.ports.find((p) => p.direction === 'output')?.width === '[0:0]',
    );
    const logicalOrGateOutput = logicalOrGateNode?.ports.find((p) => p.direction === 'output');
    expect(logicalOrGateOutput?.width).toBe('[0:0]');

    // < gets a dedicated comparator node with a 1-bit output.
    expect(comparatorNodes).toHaveLength(1);
    expect(comparatorNodes[0].metadata?.operation).toBe('<');
    const comparatorOutput = comparatorNodes[0].ports.find((p) => p.direction === 'output');
    expect(comparatorOutput?.width).toBe('[0:0]');

    // The comparator's and both logical gates' 1-bit outputs feed the wider mux
    // through explicit zext nodes.
    expect(zextNodes).toHaveLength(3);
    const muxOutput = mux.ports.find((p) => p.direction === 'output');
    for (const output of [comparatorOutput, logicalAndGateOutput, logicalOrGateOutput]) {
      const zextForOutput = zextNodes.find(
        (n) =>
          n.ports.find((p) => p.direction === 'input')?.connectedSignal === output?.connectedSignal,
      );
      expect(zextForOutput).toBeDefined();
      const zextInput = zextForOutput!.ports.find((p) => p.direction === 'input');
      const zextOutput = zextForOutput!.ports.find((p) => p.direction === 'output');
      expect(zextInput?.connectedSignal).toBe(output?.connectedSignal);
      expect(zextInput?.width).toBe(output?.width);
      expect(zextOutput?.width).not.toBe(zextInput?.width);
      expect(zextOutput?.width).toBe(muxOutput?.width);
      expect(
        mux.ports.some(
          (p) => p.direction === 'input' && p.connectedSignal === zextOutput?.connectedSignal,
        ),
      ).toBe(true);
    }

    // default: result = '0 keeps rendering as its own constant-0 block.
    expect(literalNodes.length).toBeGreaterThan(0);
    expect(mux.ports.some((p) => p.label === 'default')).toBe(true);
  });
});
