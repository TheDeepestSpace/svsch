import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';
import type { DesignModule, DiagramNode } from '../../src/ir/types';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

function muxesSelectedBy(module: DesignModule, selector: string): DiagramNode[] {
  return module.nodes.filter(
    (node) =>
      node.kind === 'mux' &&
      node.ports.some((port) => port.name === 'sel' && port.connectedSignal === selector),
  );
}

describe.each(['uhdm'] as const)('wire selector connectivity: %s', (backend) => {
  it('properly connects a wire selector from continuous assignment to a mux', async () => {
    const graph = await runParser(backend, 'wire_selector.sv', fixture('wire_selector.sv'));
    const mod = graph.modules.wire_selector;

    // We expect a mux for data_out selected by 'opcode'
    const muxes = muxesSelectedBy(mod, 'opcode');

    expect(muxes).toHaveLength(1);
    const mux = muxes[0];

    // Selector should be 'opcode'
    const selPort = mux.ports.find((p) => p.name === 'sel');
    expect(selPort?.connectedSignal).toBe('opcode');

    // There should be an edge from the producer of 'opcode' to this mux
    // opcode is instruction[6:0], so there should be a bus/select node for opcode
    expect(
      mod.edges.some((e) => e.target === mux.id && e.targetPort === 'sel' && e.signal === 'opcode'),
    ).toBe(true);
  });

  it('properly connects a procedural intermediate selector to a mux', async () => {
    const graph = await runParser(backend, 'wire_selector.sv', fixture('wire_selector.sv'));
    const mod = graph.modules.procedural_selector;

    // The selector 'opcode' is assigned 'instruction[6:0]' in the same block.
    // getOrPromoteExpr should resolve 'opcode' to the signal 'instruction[6:0]'
    // via current_drivers.

    // The mux label might show the resolved expression 'instruction[6:0]'
    const muxes = mod.nodes.filter(
      (n) =>
        n.kind === 'mux' &&
        n.ports.some((p) => p.name === 'sel' && p.connectedSignal === 'instruction[6:0]'),
    );
    expect(muxes).toHaveLength(1);
    const mux = muxes[0];

    const selPort = mux.ports.find((p) => p.name === 'sel');
    expect(selPort?.connectedSignal).toBe('instruction[6:0]');

    // There should be an edge from the bus/select node for instruction[6:0] to the mux
    expect(
      mod.edges.some(
        (e) => e.target === mux.id && e.targetPort === 'sel' && e.signal === 'instruction[6:0]',
      ),
    ).toBe(true);
  });
});
