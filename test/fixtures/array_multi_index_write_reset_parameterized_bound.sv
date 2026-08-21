module array_multi_index_write_reset_parameterized_bound #(
  parameter ADDR_WIDTH = 2,
  parameter DATA_WIDTH = 8
) (
  input  logic                     clk,
  input  logic                     reset,
  input  logic [ADDR_WIDTH-1:0]    address,
  input  logic [DATA_WIDTH-1:0]    in_data
);

  logic [DATA_WIDTH-1:0] storage [0:(1<<ADDR_WIDTH)-1];

  always @(posedge clk) begin
    if (reset) begin
      for (int a = 0; a < (1<<ADDR_WIDTH); a = a + 1) storage[a] <= '0;
    end else begin
      storage[address] <= in_data;
    end
  end
endmodule
