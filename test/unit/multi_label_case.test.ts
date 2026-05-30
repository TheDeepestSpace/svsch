import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';
import type { DesignModule, DiagramNode } from '../../src/ir/types';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe.each(['uhdm'] as const)('multi-label case statements: %s', (backend) => {
  it('extracts multiple labels on a single case branch as separate mux inputs', async () => {
    const graph = await runParser(backend, 'multi_label_case.sv', fixture('multi_label_case.sv'));
    const mod = graph.modules.multi_label_case;

    const mux = mod.nodes.find(n => n.kind === 'mux');
    expect(mux).toBeDefined();

    // Labels should be: "2'b00", "2'b01", "2'b10", "default"
    const inputPorts = mux!.ports.filter(p => p.direction === 'input' && p.name !== 'sel');
    
    // Check for "2'b00" and "2'b01" both connected to in1 (or an intermediate if promoted)
    const p00 = inputPorts.find(p => p.label === "2'b00");
    const p01 = inputPorts.find(p => p.label === "2'b01");
    const p10 = inputPorts.find(p => p.label === "2'b10");
    const pDef = inputPorts.find(p => p.label === "default");

    expect(p00).toBeDefined();
    expect(p01).toBeDefined();
    expect(p10).toBeDefined();
    expect(pDef).toBeDefined();

    expect(p00?.connectedSignal).toBe(p01?.connectedSignal);
    expect(p10?.connectedSignal).not.toBe(p00?.connectedSignal);
    
    // Find the edge driving in1 to check connectivity
    expect(mod.edges.some(e => e.target === mux!.id && e.targetPort === p00!.id)).toBe(true);
    expect(mod.edges.some(e => e.target === mux!.id && e.targetPort === p01!.id)).toBe(true);
  });
});
