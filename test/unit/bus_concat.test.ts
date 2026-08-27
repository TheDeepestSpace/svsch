import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

describe('parser: concatenation as bus composition', () => {
  it(
    'represents whole-array aggregate assignments ' + 'as stacked array bus compositions (UHDM)',
    async () => {
      const graph = await runParser(
        'uhdm',
        'array_compose_literal.sv',
        `
      module array_compose_literal(
        output logic [7:0] arr [0:3]
      );
        always_comb begin
          arr = '{8'hAB, 8'hCD, 8'hEF, 8'h00};
        end
      endmodule
    `,
      );
      const mod = graph.modules.array_compose_literal;
      const compose = mod.nodes.find(
        (n) => n.kind === 'bus' && n.metadata?.aggregateKind === 'array',
      );
      const outputPort = mod.nodes.find((n) => n.id === 'port:array_compose_literal:arr');

      expect(compose).toBeDefined();
      expect(compose).toMatchObject({
        label: 'arr',
        metadata: expect.objectContaining({
          role: 'composition',
          aggregateKind: 'array',
          isArrayNode: true,
          arrayDimension: '[0:3]',
          arraySize: 4,
        }),
      });
      expect(compose?.ports.find((p) => p.direction === 'output')).toMatchObject({
        connectedSignal: 'arr',
        width: '[7:0]',
      });
      expect(
        compose?.ports
          .filter((p) => p.direction === 'input')
          .map((p) => [p.label, p.connectedSignal, p.width]),
      ).toEqual([
        ['[3]', "8'hAB", '[7:0]'],
        ['[2]', "8'hCD", '[7:0]'],
        ['[1]', "8'hEF", '[7:0]'],
        ['[0]', "8'h00", '[7:0]'],
      ]);

      const inputEdges = mod.edges.filter(
        (e) => e.target === compose?.id && e.targetPort !== 'arr',
      );
      expect(inputEdges).toHaveLength(4);
      expect(inputEdges.every((e) => e.isStacked !== true)).toBe(true);
      expect(
        mod.edges.find((e) => e.source === compose?.id && e.target === outputPort?.id),
      ).toMatchObject({ isStacked: true });
    },
  );

  it(
    'folds per-element array assignments into ' + 'a stacked array bus composition (UHDM)',
    async () => {
      const graph = await runParser(
        'uhdm',
        'array_compose_elements.sv',
        `
      module array_compose_elements(
        input logic [7:0] seed,
        output logic [7:0] arr [0:3]
      );
        assign arr[0] = 8'h00;
        assign arr[1] = seed + 8'h01;
        assign arr[2] = seed;
        assign arr[3] = 8'hAB;
      endmodule
    `,
      );
      const mod = graph.modules.array_compose_elements;
      const compose = mod.nodes.find(
        (n) => n.kind === 'bus' && n.metadata?.aggregateKind === 'array',
      );
      const alu = mod.nodes.find(
        (n) => n.kind === 'alu' && n.metadata?.expression === "seed + 8'h01",
      );

      expect(compose).toBeDefined();
      expect(alu).toBeDefined();
      expect(compose).toMatchObject({
        label: 'arr',
        metadata: expect.objectContaining({
          role: 'composition',
          aggregateKind: 'array',
          isArrayNode: true,
          arrayDimension: '[0:3]',
          arraySize: 4,
        }),
      });
      expect(
        compose?.ports.filter((p) => p.direction === 'input').map((p) => [p.label, p.width]),
      ).toEqual([
        ['[3]', '[7:0]'],
        ['[2]', '[7:0]'],
        ['[1]', '[7:0]'],
        ['[0]', '[7:0]'],
      ]);
      expect(
        compose?.ports.find((p) => p.direction === 'input' && p.label === '[2]'),
      ).toMatchObject({
        connectedSignal: 'seed',
      });
      expect(
        compose?.ports.find((p) => p.direction === 'input' && p.label === '[1]')?.connectedSignal,
      ).toBe(alu?.ports.find((p) => p.direction === 'output')?.connectedSignal);
      expect(
        mod.edges.some(
          (e) =>
            e.source === 'port:array_compose_elements:seed' &&
            e.target === compose?.id &&
            e.isStacked === true,
        ),
      ).toBe(false);
      expect(
        mod.edges.find(
          (e) => e.source === compose?.id && e.target === 'port:array_compose_elements:arr',
        ),
      ).toMatchObject({ isStacked: true });
    },
  );

  it('represents concatenation targets as compose-then-breakout bus nodes (UHDM)', async () => {
    const graph = await runParser(
      'uhdm',
      'aggregate_assign.sv',
      `
      module aggregate_assign(
        input logic [1:0] d,
        input logic e,
        output logic a,
        output logic b,
        output logic c
      );
        assign {a, b, c} = {d, e};
      endmodule
    `,
    );
    const mod = graph.modules.aggregate_assign;
    const compose = mod.nodes.find(
      (n) => n.kind === 'bus' && n.metadata?.expression === '[aggregate-compose]',
    );
    const breakout = mod.nodes.find(
      (n) => n.kind === 'bus' && n.metadata?.expression === '[aggregate-breakout]',
    );

    expect(compose).toBeDefined();
    expect(breakout).toBeDefined();
    expect(
      compose?.ports.find((p) => p.direction === 'input' && p.connectedSignal === 'd'),
    ).toMatchObject({ label: '[2:1]', width: '[1:0]' });
    expect(
      compose?.ports.find((p) => p.direction === 'input' && p.connectedSignal === 'e'),
    ).toMatchObject({ label: '[0]', width: '[0:0]' });
    expect(
      breakout?.ports
        .filter((p) => p.direction === 'output')
        .map((p) => [p.connectedSignal, p.label]),
    ).toEqual([
      ['a', '[2]'],
      ['b', '[1]'],
      ['c', '[0]'],
    ]);
    expect(
      mod.edges.some((e) => e.source === 'port:aggregate_assign:d' && e.target === compose?.id),
    ).toBe(true);
    expect(mod.edges.some((e) => e.source === compose?.id && e.target === breakout?.id)).toBe(true);
    expect(
      mod.edges.some((e) => e.source === breakout?.id && e.target === 'port:aggregate_assign:a'),
    ).toBe(true);
    expect(
      mod.edges.some((e) => e.source === breakout?.id && e.target === 'port:aggregate_assign:b'),
    ).toBe(true);
    expect(
      mod.edges.some((e) => e.source === breakout?.id && e.target === 'port:aggregate_assign:c'),
    ).toBe(true);
  });

  it(
    'uses aggregate bridge outputs as register ' + 'inputs for nonblocking concat targets (UHDM)',
    async () => {
      const graph = await runParser(
        'uhdm',
        'aggregate_ff.sv',
        `
      module aggregate_ff(
        input logic clk,
        input logic [1:0] c,
        input logic d,
        output logic a,
        output logic [1:0] b
      );
        always_ff @(posedge clk) begin
          {a, b} <= {c, d};
        end
      endmodule
    `,
      );
      const mod = graph.modules.aggregate_ff;
      const compose = mod.nodes.find(
        (n) => n.kind === 'bus' && n.metadata?.expression === '[aggregate-compose]',
      );
      const breakout = mod.nodes.find(
        (n) => n.kind === 'bus' && n.metadata?.expression === '[aggregate-breakout]',
      );
      const regA = mod.nodes.find((n) => n.kind === 'register' && n.label === 'a');
      const regB = mod.nodes.find((n) => n.kind === 'register' && n.label === 'b');

      expect(compose).toBeDefined();
      expect(breakout).toBeDefined();
      expect(compose?.metadata?.isProcedural).toBe(true);
      expect(breakout?.metadata?.isProcedural).toBe(true);
      expect(
        breakout?.ports.some((p) => p.direction === 'output' && p.connectedSignal === 'a_next'),
      ).toBe(true);
      expect(
        breakout?.ports.some((p) => p.direction === 'output' && p.connectedSignal === 'b_next'),
      ).toBe(true);
      expect(regA?.ports.find((p) => p.name === 'D')?.connectedSignal).toBe('a_next');
      expect(regB?.ports.find((p) => p.name === 'D')?.connectedSignal).toBe('b_next');
      expect(mod.edges.some((e) => e.source === compose?.id && e.target === breakout?.id)).toBe(
        true,
      );
      expect(
        mod.edges.some(
          (e) => e.source === breakout?.id && e.target === regA?.id && e.targetPort === 'd',
        ),
      ).toBe(true);
      expect(
        mod.edges.some(
          (e) => e.source === breakout?.id && e.target === regB?.id && e.targetPort === 'd',
        ),
      ).toBe(true);
    },
  );

  it(
    'handles nested concat, replication, padding, slices, ' +
      'and struct fields in aggregate assignments (UHDM)',
    async () => {
      const graph = await runParser(
        'uhdm',
        'aggregate_edges.sv',
        `
      typedef struct packed {
        logic [3:0] opcode;
        logic valid;
      } packet_t;

      module aggregate_edges(
        input logic x,
        input logic y,
        input logic [1:0] hi,
        output logic [3:0] out,
        output packet_t pkt
      );
        assign {out[3:0], pkt.valid} = {{2{x}}, y};
        assign {pkt.opcode} = {hi};
      endmodule
    `,
      );
      const mod = graph.modules.aggregate_edges;
      const composeNodes = mod.nodes.filter(
        (n) => n.kind === 'bus' && n.metadata?.expression === '[aggregate-compose]',
      );
      const breakoutNodes = mod.nodes.filter(
        (n) => n.kind === 'bus' && n.metadata?.expression === '[aggregate-breakout]',
      );
      const repeat = mod.nodes.find((n) => n.kind === 'replicate' && n.label === 'x2');
      const structComp = mod.nodes.find(
        (n) => n.kind === 'struct' && n.id === 'struct_comp:aggregate_edges:pkt',
      );

      expect(composeNodes.length).toBeGreaterThanOrEqual(2);
      expect(breakoutNodes.length).toBeGreaterThanOrEqual(2);
      expect(repeat).toBeDefined();
      expect(composeNodes.some((n) => n.metadata?.reason === 'rhs padded to lhs width')).toBe(true);
      expect(
        breakoutNodes.some((n) =>
          n.ports.some((p) => p.direction === 'output' && p.connectedSignal === 'out[3:0]'),
        ),
      ).toBe(true);
      expect(structComp).toBeDefined();
      expect(structComp?.ports.some((p) => p.direction === 'input' && p.name === 'pkt.valid')).toBe(
        true,
      );
      expect(
        structComp?.ports.some((p) => p.direction === 'input' && p.name === 'pkt.opcode'),
      ).toBe(true);
    },
  );

  it(
    'represents replication expressions as xN ' + 'nodes with distinct output nets (UHDM)',
    async () => {
      const graph = await runParser('uhdm', 'replication_expr.sv', fixture('replication_expr.sv'));
      const mod = graph.modules.replication_expr;

      expect(mod).toBeDefined();

      const repeat = mod.nodes.find((n) => n.kind === 'replicate' && n.label === 'x20');
      expect(repeat).toBeDefined();
      expect(repeat?.metadata?.repeatCount).toBe(20);
      expect(
        repeat?.ports.some((p) => p.direction === 'input' && p.connectedSignal === 'some_wire'),
      ).toBe(true);
      expect(
        repeat?.ports.some((p) => p.direction === 'output' && p.connectedSignal === 'repeated'),
      ).toBe(true);
      expect(
        mod.edges.some(
          (e) => e.source === 'port:replication_expr:some_wire' && e.target === repeat?.id,
        ),
      ).toBe(true);
      expect(
        mod.edges.some(
          (e) => e.source === repeat?.id && e.target === 'port:replication_expr:repeated',
        ),
      ).toBe(true);
      expect(
        mod.edges.some(
          (e) =>
            e.source === 'port:replication_expr:some_wire' &&
            e.target === 'port:replication_expr:repeated',
        ),
      ).toBe(false);
    },
  );

  it('uses replication nodes as inputs to concatenation bus compositions (UHDM)', async () => {
    const graph = await runParser('uhdm', 'replication_expr.sv', fixture('replication_expr.sv'));
    const mod = graph.modules.replication_expr;

    const bus = mod.nodes.find((n) => n.kind === 'bus' && n.label === 'concat_repeated');
    const repeat = mod.nodes.find((n) => n.kind === 'replicate' && n.label === 'x22');

    expect(bus).toBeDefined();
    expect(repeat).toBeDefined();
    expect(
      bus?.ports.find((p) => p.direction === 'input' && p.connectedSignal === 'head'),
    ).toMatchObject({ name: '[23]', width: '[0:0]' });
    expect(
      bus?.ports.find(
        (p) =>
          p.direction === 'input' &&
          p.connectedSignal ===
            repeat?.ports.find((port) => port.direction === 'output')?.connectedSignal,
      ),
    ).toMatchObject({ name: '[22:1]', width: '[21:0]' });
    expect(
      bus?.ports.find((p) => p.direction === 'input' && p.connectedSignal === 'tail'),
    ).toMatchObject({ name: '[0]', width: '[0:0]' });
    expect(mod.edges.some((e) => e.source === repeat?.id && e.target === bus?.id)).toBe(true);
    expect(
      mod.edges.some((e) => e.source === 'port:replication_expr:some_wire' && e.target === bus?.id),
    ).toBe(false);
  });

  it(
    'handles replication quirks: vector operands, repeated ' +
      'concatenations, and constant parameters (UHDM)',
    async () => {
      const graph = await runParser('uhdm', 'replication_expr.sv', fixture('replication_expr.sv'));
      const mod = graph.modules.replication_expr;

      const repeatedPair = mod.nodes.find(
        (n) =>
          n.kind === 'replicate' &&
          n.label === 'x4' &&
          n.ports.some((p) => p.connectedSignal === 'repeated_pair'),
      );
      const nested = mod.nodes.find(
        (n) =>
          n.kind === 'replicate' &&
          n.label === 'x2' &&
          n.ports.some((p) => p.connectedSignal === 'nested_concat'),
      );
      const nestedInputBus = mod.nodes.find(
        (n) =>
          n.kind === 'bus' &&
          n.ports.some((p) => p.direction === 'input' && p.connectedSignal === 'head') &&
          n.ports.some((p) => p.direction === 'input' && p.connectedSignal === 'pair') &&
          n.ports.some(
            (p) =>
              p.direction === 'output' &&
              p.connectedSignal ===
                nested?.ports.find((port) => port.direction === 'input')?.connectedSignal,
          ),
      );
      const fill = mod.nodes.find(
        (n) =>
          n.kind === 'replicate' &&
          n.label === 'x FILL' &&
          n.ports.some((p) => p.connectedSignal === 'fill_ones'),
      );

      expect(repeatedPair).toBeDefined();
      expect(
        repeatedPair?.ports.some((p) => p.direction === 'input' && p.connectedSignal === 'pair'),
      ).toBe(true);
      expect(repeatedPair?.ports.find((p) => p.direction === 'output')?.width).toBe('[7:0]');

      expect(nested).toBeDefined();
      expect(nested?.ports.filter((p) => p.direction === 'input')).toHaveLength(1);
      expect(nestedInputBus).toBeDefined();
      expect(nestedInputBus?.ports.find((p) => p.direction === 'output')?.width).toBe('[2:0]');
      expect(nestedInputBus?.ports.find((p) => p.connectedSignal === 'head')).toMatchObject({
        name: '[2]',
        width: '[0:0]',
      });
      expect(nestedInputBus?.ports.find((p) => p.connectedSignal === 'pair')).toMatchObject({
        name: '[1:0]',
        width: '[1:0]',
      });
      expect(
        mod.edges.some(
          (e) => e.source === 'port:replication_expr:head' && e.target === nestedInputBus?.id,
        ),
      ).toBe(true);
      expect(
        mod.edges.some(
          (e) => e.source === 'port:replication_expr:pair' && e.target === nestedInputBus?.id,
        ),
      ).toBe(true);
      expect(
        mod.edges.some((e) => e.source === nestedInputBus?.id && e.target === nested?.id),
      ).toBe(true);

      expect(fill).toBeDefined();
      expect(fill?.metadata?.repeatCount).toBe(4);
      expect(fill?.metadata?.repeatExpression).toBe('FILL');
      expect(fill?.metadata?.repeatExpressionSource).toMatchObject({ startLine: 12 });
      expect(fill?.source).toMatchObject({
        startLine: 18,
        startColumn: 21,
        endLine: 18,
        endColumn: 33,
      });
      expect(fill?.ports.some((p) => p.direction === 'input' && p.connectedSignal === "1'b1")).toBe(
        true,
      );
    },
  );

  // eslint-disable-next-line max-len
  it('preserves operand widths for a parameterized replication and a part-select in a procedural concatenation (UHDM)', async () => {
    const graph = await runParser(
      'uhdm',
      'imm_gen.sv',
      `
      module imm_gen #(
        parameter DATA_WIDTH = 8
      ) (
        input  logic [11:0]           instr,
        output logic [DATA_WIDTH-1:0] imm
      );
        always_comb begin
          imm = {{(DATA_WIDTH-4){instr[3]}}, instr[3:0]};
        end
      endmodule
    `,
    );
    const mod = graph.modules.imm_gen;
    const bus = mod.nodes.find(
      (n) =>
        n.kind === 'bus' &&
        n.ports.some((p) => p.direction === 'output' && p.connectedSignal === 'imm'),
    );
    const replicate = mod.nodes.find((n) => n.kind === 'replicate');

    // The always_comb body is a single unconditional concat assignment, so the
    // promoted bus-composition node drives "imm" directly — no wrapping "comb"
    // alias node should be synthesized around it.
    expect(mod.nodes.some((n) => n.kind === 'comb')).toBe(false);

    expect(bus).toBeDefined();
    expect(bus?.ports.find((p) => p.direction === 'output')).toMatchObject({ width: '[7:0]' });

    expect(replicate).toBeDefined();
    expect(replicate?.metadata?.repeatCount).toBe(4);
    expect(replicate?.ports.find((p) => p.direction === 'output')?.width).toBe('[3:0]');

    const replicatedOutputSignal = replicate?.ports.find(
      (p) => p.direction === 'output',
    )?.connectedSignal;
    const replicatedInput = bus?.ports.find(
      (p) => p.direction === 'input' && p.connectedSignal === replicatedOutputSignal,
    );
    const sliceInput = bus?.ports.find(
      (p) => p.direction === 'input' && p.connectedSignal === 'instr[3:0]',
    );

    expect(replicatedInput).toMatchObject({ label: '[7:4]', width: '[3:0]' });
    expect(sliceInput).toMatchObject({ label: '[3:0]', width: '[3:0]' });
  });

  it('interprets {a, b} as a bus composition (UHDM)', async () => {
    const graph = await runParser('uhdm', 'bus_concat.sv', fixture('bus_concat.sv'));
    const mod = graph.modules.bus_concat;

    expect(mod).toBeDefined();

    // Check y_comb
    // It should be interpreted as a bus composition (kind 'bus')
    const busCombs = mod.nodes.filter((n) => n.label === 'y_comb' && n.kind === 'bus');
    expect(busCombs.length).toBe(1);
    const busComb = busCombs[0];
    expect(busComb).toBeDefined();
    expect(busComb?.label).toBe('y_comb');
    expect(busComb?.ports.find((p) => p.direction === 'output')?.width).toBe('[1:0]');
    expect(busComb?.ports.find((p) => p.direction === 'output')?.label).toBe('y_comb');

    // Check inputs and outputs
    expect(
      busComb?.ports.some(
        (p) => p.direction === 'input' && p.name === '[1]' && p.connectedSignal === 'a',
      ),
    ).toBe(true);
    expect(
      busComb?.ports.some(
        (p) => p.direction === 'input' && p.name === '[0]' && p.connectedSignal === 'b',
      ),
    ).toBe(true);
    expect(busComb?.ports.some((p) => p.direction === 'output' && p.name === 'y_comb')).toBe(true);

    // Check edges
    expect(
      mod.edges.some(
        (e) =>
          e.source === 'port:bus_concat:a' &&
          e.target === busComb?.id &&
          e.targetPort === busComb?.ports.find((p) => p.name === '[1]')?.id,
      ),
    ).toBe(true);
    expect(
      mod.edges.some(
        (e) =>
          e.source === 'port:bus_concat:b' &&
          e.target === busComb?.id &&
          e.targetPort === busComb?.ports.find((p) => p.name === '[0]')?.id,
      ),
    ).toBe(true);
    expect(
      mod.edges.some((e) => e.source === busComb?.id && e.target === 'port:bus_concat:y_comb'),
    ).toBe(true);

    // Check source range
    expect(busComb?.source).toBeDefined();
    // assign y_comb = {a, b}; is on line 8
    // {a, b} is columns 20 to 26 (0-based)
    expect(busComb?.source?.startLine).toBe(8);
    expect(busComb?.source?.startColumn).toBe(20);
    expect(busComb?.source?.endLine).toBe(8);
    expect(busComb?.source?.endColumn).toBe(26);

    // Check y_ff
    const busFfs = mod.nodes.filter((n) => n.label === 'y_ff' && n.kind === 'bus');
    expect(busFfs.length).toBe(1);
    const busFf = busFfs[0];
    expect(busFf).toBeDefined();
    expect(busFf?.label).toBe('y_ff');
    expect(busFf?.ports.find((p) => p.direction === 'output')?.width).toBe('[1:0]');
    expect(busFf?.ports.find((p) => p.direction === 'output')?.label).toBe('y_ff');
    expect(
      busFf?.ports.some(
        (p) => p.direction === 'input' && p.name === '[1]' && p.connectedSignal === 'b',
      ),
    ).toBe(true);
    expect(
      busFf?.ports.some(
        (p) => p.direction === 'input' && p.name === '[0]' && p.connectedSignal === 'a',
      ),
    ).toBe(true);

    // y_ff <= {b, a}; is on line 11
    // {b, a} is columns 16 to 22 (0-based)
    expect(busFf?.source?.startLine).toBe(11);
    expect(busFf?.source?.startColumn).toBe(16);
    expect(busFf?.source?.endLine).toBe(11);
    expect(busFf?.source?.endColumn).toBe(22);

    const regFf = mod.nodes.find((n) => n.kind === 'register' && n.label === 'y_ff');
    expect(regFf).toBeDefined();

    // Edge from bus composition to register
    expect(
      mod.edges.some(
        (e) => e.source === busFf?.id && e.target === regFf?.id && e.targetPort === 'd',
      ),
    ).toBe(true);
  });

  it('represents literals in bus compositions as literal nodes with edges (UHDM)', async () => {
    const graph = await runParser(
      'uhdm',
      'literal_composition.sv',
      `
      module literal_composition(
        input [19:0] instr_31_12,
        output logic [31:0] imm_ext
      );
        assign imm_ext = {instr_31_12, 12'h000};
      endmodule
    `,
    );
    const mod = graph.modules.literal_composition;

    const busComp = mod.nodes.find((n) => n.kind === 'bus' && n.label === 'imm_ext');
    expect(busComp).toBeDefined();

    const literalNode = mod.nodes.find((n) => n.kind === 'literal' && n.label === "12'h000");
    expect(literalNode).toBeDefined();

    const edge = mod.edges.find((e) => e.source === literalNode?.id && e.target === busComp?.id);
    expect(edge).toBeDefined();
    expect(edge?.targetPort).toBeDefined();

    const port = busComp?.ports.find((p) => p.id === edge?.targetPort);
    expect(port?.name).toBe('[11:0]');
  });

  it(
    'preserves explicit bus-composition slices ' + 'and widths from slice assignments (UHDM)',
    async () => {
      const graph = await runParser('uhdm', 'bus_composition.sv', fixture('bus_composition.sv'));
      const mod = graph.modules.bus_composition;
      const comp = mod.nodes.find((n) => n.kind === 'bus' && n.id === 'bus_comp:bus_composition:r');

      expect(comp).toBeDefined();
      expect(comp?.ports.find((p) => p.direction === 'output')).toMatchObject({
        name: 'r',
        width: '[3:0]',
      });
      expect(
        comp?.ports.find((p) => p.direction === 'input' && p.connectedSignal === 'r[0]'),
      ).toMatchObject({ name: '[0]', width: '[0:0]' });
      expect(
        comp?.ports.find((p) => p.direction === 'input' && p.connectedSignal === 'r[1]'),
      ).toMatchObject({ name: '[1]', width: '[0:0]' });
      expect(
        comp?.ports.find((p) => p.direction === 'input' && p.connectedSignal === 'r[3:2]'),
      ).toMatchObject({ name: '[3:2]', width: '[1:0]' });
    },
  );

  it('keeps bus breakouts with one input and one output per tap (UHDM)', async () => {
    const graph = await runParser(
      'uhdm',
      'top.sv',
      [
        'module top(input [3:0] bus_in, output a, output b);',
        '  assign a = bus_in[0];',
        '  assign b = bus_in[1];',
        'endmodule',
      ].join('\n'),
    );
    const mod = graph.modules.top;
    const bus = mod.nodes.find((n) => n.kind === 'bus' && n.label === 'bus_in');

    expect(bus).toBeDefined();
    expect(bus?.ports.filter((p) => p.direction === 'input')).toHaveLength(1);
    expect(bus?.ports.find((p) => p.direction === 'input')).toMatchObject({
      name: 'bus_in',
      width: '[3:0]',
    });
    expect(
      bus?.ports
        .filter((p) => p.direction === 'output')
        .map((p) => p.label)
        .sort(),
    ).toEqual(['[0]', '[1]']);
    expect(bus?.ports.filter((p) => p.direction === 'output')).toHaveLength(2);
    expect(
      mod.edges.some(
        (e) =>
          e.source === 'port:top:bus_in' && e.target === bus?.id && e.targetPort === 'in:bus_in',
      ),
    ).toBe(true);
  });

  // eslint-disable-next-line max-len
  it('preserves tap widths for a procedural bus breakout with separate statements (UHDM)', async () => {
    const graph = await runParser(
      'uhdm',
      'param_bus_breakout_procedural.sv',
      `
      module param_bus_breakout #(
        parameter DATA_WIDTH = 8
      )(
        input  logic [DATA_WIDTH-1:0] data_i,
        output logic [3:0]            hi_o,
        output logic [3:0]            lo_o
      );
        always_comb begin
          hi_o = data_i[7:4];
          lo_o = data_i[3:0];
        end
      endmodule
    `,
    );
    const mod = graph.modules.param_bus_breakout;
    const bus = mod.nodes.find((n) => n.kind === 'bus' && n.label === 'data_i');

    expect(bus).toBeDefined();
    expect(bus?.ports.find((p) => p.label === '[7:4]')).toMatchObject({ width: '[3:0]' });
    expect(bus?.ports.find((p) => p.label === '[3:0]')).toMatchObject({ width: '[3:0]' });

    const busToHi = mod.edges.find((e) => e.source === bus?.id && e.signal === 'data_i[7:4]');
    const busToLo = mod.edges.find((e) => e.source === bus?.id && e.signal === 'data_i[3:0]');
    expect(busToHi).toMatchObject({
      width: '[3:0]',
      metadata: expect.objectContaining({ thick: true }),
    });
    expect(busToLo).toMatchObject({
      width: '[3:0]',
      metadata: expect.objectContaining({ thick: true }),
    });
  });

  it('interprets {a, b} for structs as a bus composition (UHDM)', async () => {
    const graph = await runParser('uhdm', 'bus_concat.sv', fixture('bus_concat.sv'));
    const mod = graph.modules.struct_concat;

    expect(mod).toBeDefined();

    const busNodes = mod.nodes.filter(
      (n) =>
        (n.label === 'y' || n.id.includes('y:expr') || n.id.includes('bus_comp:struct_concat:y')) &&
        n.kind === 'struct',
    );
    expect(busNodes.length).toBe(1);
    const busNode = busNodes[0];
    expect(busNode).toBeDefined();
    expect(busNode?.kind).toBe('struct');
    expect(busNode?.metadata?.role).toBe('composition');
    expect(busNode?.label).toBe('y');
    expect(busNode?.ports.find((p) => p.direction === 'output')?.width).toBe('[1:0]');

    expect(
      busNode?.ports.some(
        (p) => p.direction === 'input' && p.name === 'f_a' && p.connectedSignal === 'a',
      ),
    ).toBe(true);
    expect(
      busNode?.ports.some(
        (p) => p.direction === 'input' && p.name === 'f_b' && p.connectedSignal === 'b',
      ),
    ).toBe(true);
    expect(busNode?.ports.some((p) => p.direction === 'output' && p.name === 'y')).toBe(true);

    // Check edge aggregate metadata
    const structEdge = mod.edges.find((e) => e.source === busNode?.id && e.signal === 'y');
    expect(structEdge).toBeDefined();
    expect(structEdge?.metadata?.aggregate).toBe('struct');

    // Check source range for struct concat
    // assign y = {a, b}; is on line 25
    // {a, b} is columns 15 to 21 (0-based)
    expect(busNode?.source).toBeDefined();
    expect(busNode?.source?.startLine).toBe(25);
    expect(busNode?.source?.startColumn).toBe(15);
    expect(busNode?.source?.endLine).toBe(25);
    expect(busNode?.source?.endColumn).toBe(21);
  });

  it('interprets struct breakout as individual thin lines (UHDM)', async () => {
    const graph = await runParser('uhdm', 'bus_concat.sv', fixture('bus_concat.sv'));
    const mod = graph.modules.struct_breakout;

    expect(mod).toBeDefined();

    const structNode = mod.nodes.find((n) => n.kind === 'struct' && n.label === 'u');
    expect(structNode).toBeDefined();
    expect(structNode?.metadata?.role).toBe('breakout');

    // Check edges originating from breakout node
    const edgesFromStruct = mod.edges.filter((e) => e.source === structNode?.id);
    expect(edgesFromStruct.length).toBeGreaterThan(0);

    for (const edge of edgesFromStruct) {
      // Individual fields should NOT be aggregated as 'struct' (thick lines)
      // because they represent single fields, not the whole bundle.
      expect(edge.metadata?.aggregate).not.toBe('struct');
    }
  });

  it(
    'renders multi-bit array-breakout taps as thick wires, ' +
      'while the hub edge feeding the breakout stays stacked (UHDM)',
    async () => {
      const graph = await runParser(
        'uhdm',
        'array_breakout_multibit.sv',
        `
      module array_breakout_multibit(
        inout wire [7:0] a [0:1],
        output logic [7:0] elem0,
        output logic [7:0] elem1
      );
        assign elem0 = a[0];
        assign elem1 = a[1];
      endmodule
    `,
      );
      const mod = graph.modules.array_breakout_multibit;
      expect(mod).toBeDefined();

      const breakout = mod.nodes.find(
        (n) => n.kind === 'bus' && n.metadata?.aggregateKind === 'array',
      );
      expect(breakout).toBeDefined();
      expect(breakout?.metadata?.role).not.toBe('composition');

      // The hub edge feeding the breakout node from the boundary `a` port
      // carries two distinct 8-bit array elements bundled onto one wire —
      // it stays stacked regardless of the per-element width.
      const hubEdge = mod.edges.find((e) => e.target === breakout?.id);
      expect(hubEdge).toBeDefined();
      expect(hubEdge?.width).toBe('[7:0]');
      expect(hubEdge?.isStacked).toBe(true);

      // The taps fanning *out* of the breakout are where the bug showed up:
      // each tap is an 8-bit-wide net, not a scalar lane, so it must render
      // as one thick wire, not a stacked bundle.
      const tapEdges = mod.edges.filter((e) => e.source === breakout?.id);
      expect(tapEdges).toHaveLength(2);
      for (const edge of tapEdges) {
        expect(edge.isStacked).not.toBe(true);
        expect(edge.metadata?.thick).toBe(true);
      }
    },
  );

  it(
    'renders a multi-bit array-breakout tap into a mux selector as a thick ' +
      'wire, not a stacked bundle (UHDM)',
    async () => {
      const graph = await runParser(
        'uhdm',
        'array_breakout_multibit_mux.sv',
        `
      module array_breakout_multibit_mux(
        input  logic [7:0] drive_enable [0:1],
        inout  wire  [7:0] a [0:1]
      );
        assign a[0] = drive_enable[0] ? 8'hff : 8'hzz;
        assign a[1] = drive_enable[1] ? 8'hff : 8'hzz;
      endmodule
    `,
      );
      const mod = graph.modules.array_breakout_multibit_mux;
      expect(mod).toBeDefined();

      const breakout = mod.nodes.find(
        (n) =>
          n.kind === 'bus' &&
          n.metadata?.aggregateKind === 'array' &&
          n.metadata?.role !== 'composition',
      );
      expect(breakout).toBeDefined();

      // Before the fix, every tap out of a breakout node was marked stacked
      // whenever it fed another array-capable node (here, the per-element
      // tristate muxes selected by `drive_enable[i]`), regardless of the
      // element width.
      const tapEdges = mod.edges.filter((e) => e.source === breakout?.id);
      expect(tapEdges).toHaveLength(2);
      for (const edge of tapEdges) {
        expect(edge.isStacked).not.toBe(true);
        expect(edge.metadata?.thick).toBe(true);
      }

      const hubEdge = mod.edges.find((e) => e.target === breakout?.id);
      expect(hubEdge).toBeDefined();
      expect(hubEdge?.isStacked).toBe(true);
    },
  );

  it('keeps a scalar (1-bit) array-breakout tap stacked, not thick (UHDM)', async () => {
    const graph = await runParser(
      'uhdm',
      'array_breakout_scalar.sv',
      `
      module array_breakout_scalar(
        inout wire a [0:1],
        output logic elem0,
        output logic elem1
      );
        assign elem0 = a[0];
        assign elem1 = a[1];
      endmodule
    `,
    );
    const mod = graph.modules.array_breakout_scalar;
    expect(mod).toBeDefined();

    const breakout = mod.nodes.find(
      (n) => n.kind === 'bus' && n.metadata?.aggregateKind === 'array',
    );
    expect(breakout).toBeDefined();

    const hubEdge = mod.edges.find((e) => e.target === breakout?.id);
    expect(hubEdge).toBeDefined();
    expect(hubEdge?.isStacked).toBe(true);
  });
});
