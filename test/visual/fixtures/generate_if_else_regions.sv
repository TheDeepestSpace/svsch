module generate_if_else_leaf(input logic a, output logic y);
  assign y = a;
endmodule

module generate_if_else_regions #(
  parameter MODE = 1
) (
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  logic w;

  generate
    if (MODE == 0) begin : g_if_zero
      generate_if_else_leaf u_if_zero(.a(a), .y(w));
    end else if (MODE == 1) begin : g_if_one
      generate_if_else_leaf u_if_one(.a(b), .y(w));
    end else begin : g_if_other
      assign w = c;
    end
  endgenerate

  assign y = w;
endmodule
