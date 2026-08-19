import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe.each(['uhdm'] as const)('struct propagation: %s', (backend) => {
  it('preserves struct metadata on mux outputs', async () => {
    const graph = await runParser(backend, 'struct_passing.sv', fixture('struct_passing.sv'));
    const mod = graph.modules.struct_mux;

    // The output port edge should have aggregate: 'struct'
    const outEdge = mod.edges.find((e) => e.target === 'port:struct_mux:out');
    expect(outEdge).toBeDefined();
    expect(outEdge?.metadata?.aggregate).toBe('struct');

    // Mux input edges from in1 and in2 should also be structs
    const in1Edge = mod.edges.find((e) => e.signal === 'in1');
    expect(in1Edge?.metadata?.aggregate).toBe('struct');
  });

  it('preserves struct metadata on complex expressions', async () => {
    const graph = await runParser(backend, 'struct_passing.sv', fixture('struct_passing.sv'));
    const mod = graph.modules.struct_complex;

    // The edge from the XOR comb node to 'out' should be a struct
    const outEdge = mod.edges.find((e) => e.target === 'port:struct_complex:out');
    expect(outEdge).toBeDefined();
    expect(outEdge?.metadata?.aggregate).toBe('struct');
  });
});
