import { describe, expect, it } from 'vitest';
import { runParser } from '../helper';
import type { DesignModule, GenerateRegion } from '../../src/ir/types';

// The generate/endgenerate keywords are optional in SystemVerilog — a bare if/case at
// module level is an implicit generate. Extraction must not depend on the keyword.
const SOURCE = `
module gen_kw_leaf(input logic a, output logic y);
  assign y = a;
endmodule

module gen_with_keyword #(parameter MODE = 1) (
  input logic a,
  input logic b,
  input logic c,
  output logic y,
  output logic z
);
  logic w;
  logic v;

  generate
    if (MODE == 0) begin : g_zero
      gen_kw_leaf u_zero(.a(a), .y(w));
    end else begin : g_other
      gen_kw_leaf u_other(.a(b), .y(w));
    end
  endgenerate

  generate
    case (MODE)
      0: begin : g_case_zero
        gen_kw_leaf u_case_zero(.a(a), .y(v));
      end
      default: begin : g_case_def
        gen_kw_leaf u_case_def(.a(c), .y(v));
      end
    endcase
  endgenerate

  assign y = w;
  assign z = v;
endmodule

module gen_without_keyword #(parameter MODE = 1) (
  input logic a,
  input logic b,
  input logic c,
  output logic y,
  output logic z
);
  logic w;
  logic v;

  if (MODE == 0) begin : g_zero
    gen_kw_leaf u_zero(.a(a), .y(w));
  end else begin : g_other
    gen_kw_leaf u_other(.a(b), .y(w));
  end

  case (MODE)
    0: begin : g_case_zero
      gen_kw_leaf u_case_zero(.a(a), .y(v));
    end
    default: begin : g_case_def
      gen_kw_leaf u_case_def(.a(c), .y(v));
    end
  endcase

  assign y = w;
  assign z = v;
endmodule

module gen_two_bare_chains #(parameter MODE = 1) (
  input logic a,
  input logic b,
  output logic y,
  output logic z
);
  if (MODE == 1) begin : g_first
    gen_kw_leaf u_first(.a(a), .y(y));
  end else begin : g_first_other
    assign y = 1'b0;
  end

  if (MODE == 1) begin : g_second
    gen_kw_leaf u_second(.a(b), .y(z));
  end else begin : g_second_other
    assign z = 1'b0;
  end
endmodule
`;

function regionSummary(region: GenerateRegion) {
  return {
    kind: region.kind,
    label: region.label,
    blockLabel: region.blockLabel,
    activeState: region.activeState,
    nodeCount: region.nodeIds?.length ?? 0,
    isGenerateBlock: region.isGenerateBlock ?? false,
  };
}

function armsOf(module: DesignModule): GenerateRegion[] {
  return (module.generateRegions ?? []).filter((region) => !region.isGenerateBlock);
}

function wrappersOf(module: DesignModule): GenerateRegion[] {
  return (module.generateRegions ?? []).filter((region) => region.isGenerateBlock);
}

describe('generate keyword is optional', () => {
  it('extracts identical regions with and without generate/endgenerate', async () => {
    const graph = await runParser('uhdm', 'gen_keyword.sv', SOURCE);
    const withKeyword = graph.modules['gen_with_keyword'];
    const withoutKeyword = graph.modules['gen_without_keyword'];
    expect(withKeyword).toBeDefined();
    expect(withoutKeyword).toBeDefined();

    const sortKey = (item: ReturnType<typeof regionSummary>) => `${item.kind}:${item.label}`;
    const summarize = (module: DesignModule) =>
      (module.generateRegions ?? [])
        .map(regionSummary)
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    expect(summarize(withoutKeyword)).toEqual(summarize(withKeyword));

    // Both variants synthesize one wrapper per expression, arms parented under it.
    for (const module of [withKeyword, withoutKeyword]) {
      const wrappers = wrappersOf(module);
      expect(wrappers.map((wrapper) => wrapper.label).sort()).toEqual([
        'generate case (MODE)',
        'generate if',
      ]);
      for (const arm of armsOf(module)) {
        expect(wrappers.some((wrapper) => wrapper.id === arm.parentRegionId)).toBe(true);
      }
    }
  }, 120000);

  it('keeps two keyword-less if/else chains in separate sibling groups', async () => {
    const graph = await runParser('uhdm', 'gen_keyword.sv', SOURCE);
    const module = graph.modules['gen_two_bare_chains'];
    expect(module).toBeDefined();

    const arms = armsOf(module);
    expect(arms).toHaveLength(4);

    const groupOf = (blockLabel: string) =>
      arms.find((arm) => arm.blockLabel === blockLabel)?.siblingGroupId;
    expect(groupOf('g_first')).toBeDefined();
    expect(groupOf('g_first')).toBe(groupOf('g_first_other'));
    expect(groupOf('g_second')).toBe(groupOf('g_second_other'));
    expect(groupOf('g_first')).not.toBe(groupOf('g_second'));

    // Two chains, two wrappers.
    expect(wrappersOf(module)).toHaveLength(2);
  }, 120000);
});
