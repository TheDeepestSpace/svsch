import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('enum concatenation widths', () => {
  it('preserves internal enum and vector widths in an instantiated case selector', async () => {
    const graph = await runParser('uhdm', [
      { file: 'enum_concat_case_top.sv', text: fixture('enum_concat_case_top.sv') },
      { file: 'enum_concat_case.sv', text: fixture('enum_concat_case.sv') },
    ]);
    const mod = graph.modules.enum_concat_case;
    const bus = mod.nodes.find(
      (node) =>
        node.kind === 'bus' &&
        node.ports.some((port) => port.connectedSignal === 'transfersize') &&
        node.ports.some((port) => port.connectedSignal === 'byte_index'),
    );

    expect(bus).toBeDefined();
    expect(
      bus?.ports
        .filter((port) => port.direction === 'input')
        .map((port) => [port.connectedSignal, port.name, port.width]),
    ).toEqual([
      ['transfersize', '[3:2]', '[1:0]'],
      ['byte_index', '[1:0]', '[1:0]'],
    ]);
    expect(bus?.ports.find((port) => port.direction === 'output')?.width).toBe('[3:0]');
  });
});
