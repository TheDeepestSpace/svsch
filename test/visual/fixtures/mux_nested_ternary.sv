module mux_nested_ternary(
  input logic sel1,
  input logic sel2,
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  assign y = sel1 ? (sel2 ? a : b) : c;
endmodule
