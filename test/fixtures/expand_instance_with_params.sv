// Same shape as expand_instance.sv (one register node, 3 boundary ports) but
// the leaf carries a WIDTH parameter overridden at the instantiation site —
// exercises expandTopPad's extra header reservation for instanceParamRows
// (see expand_instance.visual.spec.ts's "overridden parameters" test).
module param_leaf #(
  parameter WIDTH = 8
)(
  input  logic clk,
  input  logic [WIDTH-1:0] a,
  output logic [WIDTH-1:0] y
);
  always_ff @(posedge clk) begin
    y <= a;
  end
endmodule

module top(
  input  logic clk,
  input  logic [15:0] a,
  output logic [15:0] y
);
  param_leaf #(.WIDTH(16)) u1(.clk(clk), .a(a), .y(y));
endmodule
