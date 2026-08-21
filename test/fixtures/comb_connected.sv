module comb_connected (
  input logic a,
  input logic b,
  output logic decoded
);
  // Multiplication isn't promoted to any dedicated node kind (gate/alu/
  // comparator/mux/...), so this always falls back to a generic comb block.
  assign decoded = a * b;
endmodule
