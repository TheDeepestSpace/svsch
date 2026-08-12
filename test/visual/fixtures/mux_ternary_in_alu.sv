module mux_ternary_in_alu(
  input logic sel,
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  assign y = a + (sel ? b : c);
endmodule
