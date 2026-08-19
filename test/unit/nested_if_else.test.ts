import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe.each(['uhdm'] as const)('nested if-else: %s', (backend) => {
  it('does not create self-feedback loops in nested if-else muxes', async () => {
    const graph = await runParser(backend, 'nested_if_else.sv', fixture('nested_if_else.sv'));
    const mod = graph.modules.nested_if_clocked;

    // We expect a mux for 'out'
    const muxes = mod.nodes.filter((n) => n.kind === 'mux');

    for (const mux of muxes) {
      const outPort = mux.ports.find((p) => p.direction === 'output' && p.name === 'out');
      const falsePort = mux.ports.find((p) => p.direction === 'input' && p.name === 'false');

      expect(outPort).toBeDefined();
      expect(falsePort).toBeDefined();

      // CRITICAL: The false branch input should NOT be the same as the output signal
      // If it is, it's a zero-delay feedback loop (latch or bug).
      expect(falsePort?.connectedSignal).not.toBe(outPort?.connectedSignal);
    }
  });

  it('correctly handles nested if-else-if-else without creating loops', async () => {
    const graph = await runParser(
      'uhdm',
      'nested_if_else.sv',
      `
      module nested_if_else_chain (
          input logic a,
          input logic b,
          input logic [7:0] in1,
          input logic [7:0] in2,
          input logic [7:0] in3,
          output logic [7:0] out
      );
      always_comb begin
          if (a) begin
              if (b) out = in1;
              else out = in2;
          end else begin
              out = in3;
          end
      end
      endmodule
    `,
    );
    const mod = graph.modules.nested_if_else_chain;

    const muxes = mod.nodes.filter((n) => n.kind === 'mux');
    expect(muxes).toHaveLength(2);

    for (const mux of muxes) {
      const outPort = mux.ports.find((p) => p.direction === 'output');
      const falsePort = mux.ports.find((p) => p.name === 'false');
      const truePort = mux.ports.find((p) => p.name === 'true');

      expect(outPort?.connectedSignal).not.toBe(falsePort?.connectedSignal);
      expect(outPort?.connectedSignal).not.toBe(truePort?.connectedSignal);
    }
  });

  it('correctly handles specific if-else-if-else case reported by user', async () => {
    const graph = await runParser(
      'uhdm',
      'nested_if_else_user.sv',
      `
      module nested_if_else_user (
          input logic x,
          input logic b,
          input logic [7:0] a,
          input logic [7:0] c,
          input logic [7:0] d,
          output logic [7:0] y
      );
      always_comb begin
          if (x) y = a;
          else if (b) y = c;
          else y = d;
      end
      endmodule
    `,
    );
    const mod = graph.modules.nested_if_else_user;

    // We expect two muxes:
    // Mux 1 (nested): sel=b, true=c, false=d, out=y_if_false_<id>
    // Mux 2 (outer):  sel=x, true=a, false=y_if_false_<id>, out=y

    const muxes = mod.nodes.filter((n) => n.kind === 'mux');
    expect(muxes).toHaveLength(2);

    for (const mux of muxes) {
      const outPort = mux.ports.find((p) => p.direction === 'output');
      const truePort = mux.ports.find((p) => p.name === 'true');
      const falsePort = mux.ports.find((p) => p.name === 'false');

      // Check for self-feedback loop (collision bug)
      expect(outPort?.connectedSignal).not.toBe(falsePort?.connectedSignal);
      expect(outPort?.connectedSignal).not.toBe(truePort?.connectedSignal);
    }

    // Verify chain connectivity
    const outerMux = muxes.find((n) =>
      n.ports.some((p) => p.name === 'sel' && p.connectedSignal === 'x'),
    );
    const nestedMux = muxes.find((n) =>
      n.ports.some((p) => p.name === 'sel' && p.connectedSignal === 'b'),
    );

    expect(outerMux).toBeDefined();
    expect(nestedMux).toBeDefined();

    const nestedOutput = nestedMux?.ports.find((p) => p.direction === 'output')?.connectedSignal;
    const outerFalseInput = outerMux?.ports.find((p) => p.name === 'false')?.connectedSignal;

    expect(outerFalseInput).toBe(nestedOutput);
    expect(outerMux?.ports.find((p) => p.direction === 'output')?.connectedSignal).toBe('y');
  });
});
