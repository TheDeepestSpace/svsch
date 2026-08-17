module mux_ternary(
  input logic sel,
  input logic a,
  input logic b,
  output logic y
);
  assign y = sel ? a : b;
endmodule
