// Structural cross-coupled NOR SR latch: the other common textbook gate-level
// SR latch topology (NOR instead of NAND, active-high set/reset), exercising
// the same combinational feedback detection over a different gate primitive.
module sr_latch_gate_nor (
  input  logic s,
  input  logic r,
  output logic q,
  output logic qn
);
  assign q  = ~(r | qn);
  assign qn = ~(s | q);
endmodule
