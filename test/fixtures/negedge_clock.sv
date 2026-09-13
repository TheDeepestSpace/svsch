module negedge_clock(input logic clk, input logic d, output logic q);
  always_ff @(negedge clk) begin
    q <= d;
  end
endmodule
