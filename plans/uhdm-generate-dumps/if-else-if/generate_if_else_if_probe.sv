module leaf(input logic a, output logic y);
  assign y = a;
endmodule

module top #(parameter int SEL = 1) (
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  logic w;

  generate
    if (SEL == 0) begin : g_if_0
      leaf u0(.a(a), .y(w));
    end else if (SEL == 1) begin : g_if_1
      leaf u1(.a(b), .y(w));
    end else begin : g_if_default
      leaf u_default(.a(c), .y(w));
    end
  endgenerate

  assign y = w;
endmodule
