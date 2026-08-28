module logical_gate_chains (
  input  logic a,
  input  logic b,
  input  logic c,
  input  logic d,
  input  logic e,
  input  logic f,
  input  logic g,
  input  logic [3:0] p,
  input  logic [3:0] q,
  input  logic r,
  input  logic [3:0] s,
  input  logic [3:0] t,
  input  logic [3:0] x,
  input  logic [3:0] y,
  input  logic z,
  output logic and_chain,
  output logic or_chain,
  output logic mixed_comparators,
  output logic bitwise_logical_fallback
);
  // Same-operator chain flattens into one n-input AND gate.
  assign and_chain = a && b && c && d;

  // Same-operator chain flattens into one n-input OR gate.
  assign or_chain = e || f || g;

  // Comparator leaves stay as separate comparator nodes feeding one 3-input AND gate.
  assign mixed_comparators = (p == q) && r && (s == t);

  // Mixed bitwise/logical expression stays one opaque comb node, not a gate.
  assign bitwise_logical_fallback = (x & y) || z;
endmodule
