module data_mem #(
  parameter ADDR_WIDTH = 8,
  parameter DATA_WIDTH = 8
) (
  input  logic                  clk,
  input  logic                  mem_write,
  input  logic [ADDR_WIDTH-1:0] addr,
  input  logic [DATA_WIDTH-1:0] write_data,
  output logic [DATA_WIDTH-1:0] read_data
);

  logic [DATA_WIDTH-1:0] ram [0:(1<<ADDR_WIDTH)-1];

  assign read_data = ram[addr];

  always_ff @(posedge clk) begin
    if (mem_write) begin
      ram[addr] <= write_data;
    end
  end

endmodule
