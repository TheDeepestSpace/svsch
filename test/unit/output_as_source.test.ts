import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('output as source', () => {
  it('should not use output port as a source for internal wires', async () => {
    const graph = await runParser('uhdm', 'output_as_source.sv', fixture('output_as_source.sv'));
    const mod = graph.modules.output_as_source;

    // Find the edge driving 'i' (which is used by 'r')
    // 'i' should be driven by 'a.b' (or a select node from 'a')
    // NOT by 'c'

    const cPortAsSource = mod.edges.filter((e) => e.source === 'port:output_as_source:c');
    expect(cPortAsSource.length, 'Output port should not be a source for internal wires').toBe(0);

    const busCIncoming = mod.edges.filter((e) => e.target === 'bus:output_as_source:c');
    expect(
      busCIncoming.length,
      'Bus node for "c" should have an incoming edge from its driver',
    ).toBeGreaterThan(0);
    expect(busCIncoming[0].source).toBe('struct:output_as_source:a');
  });
});
