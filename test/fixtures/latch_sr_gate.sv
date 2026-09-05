// Structural cross-coupled NAND SR latch: a genuine combinational feedback
// loop (q and qn each feed the other gate), unlike latch_sr.sv which models
// the same latch behaviorally and lands on the inferred-latch node kind.
module sr_latch_gate (
  input  logic s_n,
  input  logic r_n,
  output logic q,
  output logic qn
);
  assign q  = ~(s_n & qn);
  assign qn = ~(r_n & q);
endmodule
