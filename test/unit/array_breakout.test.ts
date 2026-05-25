import { describe, expect, it } from 'vitest';
import { runParser } from '../helper';

describe('parser: array breakout', () => {
  it('represents array element accesses as array breakouts (CPP)', async () => {
    const graph = await runParser('cpp', 'array_stack_breakout.sv', `
      module array_stack_breakout(
        input logic [7:0] arr [0:3],
        output logic [7:0] elem0,
        output logic [7:0] elem1,
        output logic [7:0] elem2,
        output logic [7:0] elem3
      );
        assign elem0 = arr[0];
        assign elem1 = arr[1];
        assign elem2 = arr[2];
        assign elem3 = arr[3];
      endmodule
    `);
    const mod = graph.modules.array_stack_breakout;
    const breakout = mod.nodes.find(n => n.kind === 'bus' && n.label === 'arr');
    expect(breakout).toBeDefined();
    console.log(JSON.stringify(breakout, null, 2));
  });
});
