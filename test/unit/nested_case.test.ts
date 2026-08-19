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

describe.each(['uhdm'] as const)('nested case statements: %s', (backend) => {
  it('extracts nested case statements as nested muxes', async () => {
    const graph = await runParser(backend, 'nested_case.sv', fixture('nested_case.sv'));
    const mod = graph.modules.nested_case;

    // We expect two muxes for data_out:
    // 1. Inner mux selected by sel_b
    // 2. Outer mux selected by sel_a

    const muxesA = muxesSelectedBy(mod, 'sel_a');
    const muxesB = muxesSelectedBy(mod, 'sel_b');

    expect(muxesA).toHaveLength(1);
    expect(muxesB).toHaveLength(1);

    const muxA = muxesA[0];
    const muxB = muxesB[0];

    // Inner mux (sel_b) should have data_in1, data_in2, and 8'h00 as inputs
    expect(muxB.ports.some((p) => p.label === "2'b00" && p.connectedSignal === 'data_in1')).toBe(
      true,
    );
    expect(muxB.ports.some((p) => p.label === "2'b01" && p.connectedSignal === 'data_in2')).toBe(
      true,
    );
    // Explicit default branch: signal might be renamed
    expect(muxB.ports.some((p) => p.label === 'default')).toBe(true);

    // Outer mux (sel_a) should have inner mux output, 8'hFF, and 8'hAA as inputs
    const muxBOutput = muxB.ports.find((p) => p.direction === 'output')?.connectedSignal;
    expect(muxBOutput).toBeDefined();

    expect(muxA.ports.some((p) => p.label === "2'b00" && p.connectedSignal === muxBOutput)).toBe(
      true,
    );
    // 8'hFF and 8'hAA might be renamed if they are explicit branches
    expect(muxA.ports.some((p) => p.label === "2'b01")).toBe(true);
    expect(muxA.ports.some((p) => p.label === 'default')).toBe(true);

    // Final output should be from muxA
    const muxAOutput = muxA.ports.find((p) => p.direction === 'output')?.connectedSignal;
    expect(muxAOutput).toBeDefined();
    expect(
      mod.edges.some((e) => e.source === muxA.id && e.target === 'port:nested_case:data_out'),
    ).toBe(true);
  });

  it('handles missing branches in nested cases by using values from outer scope', async () => {
    const graph = await runParser(backend, 'nested_case.sv', fixture('nested_case.sv'));
    const mod = graph.modules.nested_case_missing_branch;

    const muxesA = muxesSelectedBy(mod, 'sel_a');
    const muxesB = muxesSelectedBy(mod, 'sel_b');

    expect(muxesA).toHaveLength(1);
    expect(muxesB).toHaveLength(1);

    const muxA = muxesA[0];
    const muxB = muxesB[0];

    // Inner mux (sel_b) for out:
    // 2'b00 branch: out = in1
    // default/other branches: should use the 'out' from before the inner case
    // In the fixture, out = 8'h00 is before the outer case.

    expect(muxB.ports.some((p) => p.label === "2'b00" && p.connectedSignal === 'in1')).toBe(true);
    // The default/implicit branch of the inner case should be 8'h00
    expect(muxB.ports.some((p) => p.label === 'default' && p.connectedSignal.includes('0'))).toBe(
      true,
    );

    const muxBOutput = muxB.ports.find((p) => p.direction === 'output')?.connectedSignal;

    // Outer mux (sel_a) for out:
    // 2'b00 branch: muxBOutput
    // 2'b01 branch: in2
    // default branch: 8'h00 (initial value)
    expect(muxA.ports.some((p) => p.label === "2'b00" && p.connectedSignal === muxBOutput)).toBe(
      true,
    );
    expect(muxA.ports.some((p) => p.label === "2'b01" && p.connectedSignal === 'in2')).toBe(true);
    expect(muxA.ports.some((p) => p.label === 'default' && p.connectedSignal.includes('0'))).toBe(
      true,
    );
  });

  it('avoids ID collisions when multiple case statements use the same selector', async () => {
    const graph = await runParser('uhdm', 'nested_case.sv', fixture('nested_case.sv'));
    const mod = graph.modules.nested_case_collision;

    const muxesB = muxesSelectedBy(mod, 'sel_b');

    // We expect TWO different muxes for sel_b because they are in different branches of sel_a
    expect(muxesB).toHaveLength(2);

    const ids = muxesB.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(2);
  });

  it('does not collide literal signal names for identical labels in sibling cases', async () => {
    const graph = await runParser(backend, 'nested_case.sv', fixture('nested_case.sv'));
    const mod = graph.modules.nested_case_literal_collision;

    const muxesInner = muxesSelectedBy(mod, 'sel_inner');
    expect(muxesInner).toHaveLength(2);

    // Each inner mux's 2'b01 arm should be driven by its own literal node
    // (4'hA vs 4'hB), not a shared node whichever case was elaborated first.
    const literalSignals = muxesInner.map((mux) => {
      const port = mux.ports.find((p) => p.label === "2'b01");
      expect(port).toBeDefined();
      return port!.connectedSignal;
    });

    expect(new Set(literalSignals).size).toBe(2);

    const literalLabels = literalSignals.map((signal) => {
      const node = mod.nodes.find(
        (n) =>
          n.kind === 'literal' &&
          n.ports.some((p) => p.direction === 'output' && p.connectedSignal === signal),
      );
      expect(node).toBeDefined();
      return node!.label;
    });

    expect(literalLabels.sort()).toEqual(["4'hA", "4'hB"]);
  });
});
