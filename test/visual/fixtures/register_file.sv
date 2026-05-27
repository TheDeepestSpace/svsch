module register_file
  ( input clk
  , input reset
  , input logic [4:0] addr
  , input logic [31:0] val_in
  , output logic [31:0] val_out
  );

  reg [31:0] M [0:31];

  always @(posedge clk) begin

    if (reset) begin
      M[addr] <= 32'b0;
    end else begin
      M[addr] <= val_in;
    end
  end

  assign val_out = M[addr];

endmodule
