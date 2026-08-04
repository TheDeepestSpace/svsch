module instr_mem #(
  parameter ADDR_WIDTH = 8,
  parameter DATA_WIDTH = 8
) (
  input  logic [ADDR_WIDTH-1:0] addr,
  output logic [DATA_WIDTH-1:0] instr
);

  logic [DATA_WIDTH-1:0] mem [0:255];

  assign instr = mem[addr];

endmodule
