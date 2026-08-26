module leaf(input logic clk, input logic a, output logic y);
  always_ff @(posedge clk) begin
    y <= a;
  end
endmodule

module top(input logic clk, input logic a, output logic y);
  leaf u1(.clk(clk), .a(a), .y(y));
endmodule
