module async_reset_clock_reordered(input logic rst_n, input logic tck, input logic d, output logic q);
  always_ff @(negedge rst_n or posedge tck) begin
    if (!rst_n) q <= 1'b0;
    else q <= d;
  end
endmodule
