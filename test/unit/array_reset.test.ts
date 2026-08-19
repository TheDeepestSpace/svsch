import { describe, expect, it } from 'vitest';
import { runParser } from '../helper';

describe('Array Reset Syntaxes', () => {
  it("recognizes '{default: 32'b0} as a zero reset", async () => {
    const code = `
      module array_reset_default (
          input logic clk,
          input logic rst,
          input logic [31:0] write_data,
          input logic [2:0] address,
          output logic [31:0] read_data
      );
          logic [31:0] M [0:7];
          always_ff @(posedge clk or posedge rst) begin
              if (rst) M <= '{default: 32'b0};
              else M[address] <= write_data;
          end
          assign read_data = M[address];
      endmodule
    `;
    const graph = await runParser('uhdm', [{ file: 'array_reset_default.sv', text: code }]);
    const mod = graph.modules.array_reset_default;
    const reg = mod.nodes.find((n) => n.id === 'reg:array_reset_default:M');
    expect(reg).toBeDefined();
    // If it's recognized as a zero reset, it should NOT have an RV port
    expect(reg?.ports.some((p) => p.id === 'rv')).toBe(false);
  });

  it("recognizes '{default: 0} as a zero reset", async () => {
    const code = `
      module array_reset_zero (
          input logic clk,
          input logic rst,
          input logic [31:0] write_data,
          input logic [2:0] address,
          output logic [31:0] read_data
      );
          logic [31:0] M [0:7];
          always_ff @(posedge clk or posedge rst) begin
              if (rst) M <= '{default: 0};
              else M[address] <= write_data;
          end
          assign read_data = M[address];
      endmodule
    `;
    const graph = await runParser('uhdm', [{ file: 'array_reset_zero.sv', text: code }]);
    const mod = graph.modules.array_reset_zero;
    const reg = mod.nodes.find((n) => n.id === 'reg:array_reset_zero:M');
    expect(reg?.ports.some((p) => p.id === 'rv')).toBe(false);
  });

  it("recognizes '{default: '0} as a zero reset", async () => {
    const code = `
      module array_reset_tick_zero (
          input logic clk,
          input logic rst,
          input logic [31:0] write_data,
          input logic [2:0] address,
          output logic [31:0] read_data
      );
          logic [31:0] M [0:7];
          always_ff @(posedge clk or posedge rst) begin
              if (rst) M <= '{default: '0};
              else M[address] <= write_data;
          end
          assign read_data = M[address];
      endmodule
    `;
    const graph = await runParser('uhdm', [{ file: 'array_reset_tick_zero.sv', text: code }]);
    const mod = graph.modules.array_reset_tick_zero;
    const reg = mod.nodes.find((n) => n.id === 'reg:array_reset_tick_zero:M');
    expect(reg?.ports.some((p) => p.id === 'rv')).toBe(false);
  });

  it('recognizes non-zero reset pattern as non-zero', async () => {
    const code = `
      module array_reset_nonzero (
          input logic clk,
          input logic rst,
          input logic [31:0] write_data,
          input logic [2:0] address,
          output logic [31:0] read_data
      );
          logic [31:0] M [0:7];
          always_ff @(posedge clk or posedge rst) begin
              if (rst) M <= '{default: 32'hDEADBEEF};
              else M[address] <= write_data;
          end
          assign read_data = M[address];
      endmodule
    `;
    const graph = await runParser('uhdm', [{ file: 'array_reset_nonzero.sv', text: code }]);
    const mod = graph.modules.array_reset_nonzero;
    const reg = mod.nodes.find((n) => n.id === 'reg:array_reset_nonzero:M');
    expect(reg?.ports.some((p) => p.id === 'rv')).toBe(true);
  });

  it("recognizes explicit zero pattern '{0, 0, ...} as zero reset", async () => {
    const code = `
      module array_reset_explicit (
          input logic clk,
          input logic rst,
          input logic [31:0] write_data,
          input logic [2:0] address,
          output logic [31:0] read_data
      );
          logic [31:0] M [0:3];
          always_ff @(posedge clk or posedge rst) begin
              if (rst) M <= '{32'b0, 32'b0, 32'b0, 32'b0};
              else M[address] <= write_data;
          end
          assign read_data = M[address];
      endmodule
    `;
    const graph = await runParser('uhdm', [{ file: 'array_reset_explicit.sv', text: code }]);
    const mod = graph.modules.array_reset_explicit;
    const reg = mod.nodes.find((n) => n.id === 'reg:array_reset_explicit:M');
    expect(reg?.ports.some((p) => p.id === 'rv')).toBe(false);
  });
});
