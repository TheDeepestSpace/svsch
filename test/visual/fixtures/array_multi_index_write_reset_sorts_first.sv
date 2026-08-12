module array_multi_index_write_reset_sorts_first
  ( input logic clk
  , input logic reset
  , input logic [4:0] address
  , input logic [31:0] in_data
  );

  reg [31:0] storage [0:31];
  integer a;

  always @(posedge clk) begin
    if (reset) begin
      for (a = 0; a < 32; a = a + 1) storage[a] <= 32'b0;
    end else begin
      storage[address] <= in_data;
    end
  end
endmodule
