// A more complex structural feedback example: the classic gated D-latch built
// from five NAND/NOT gates. Only the q/qn cross-coupled pair closes a genuine
// combinational cycle; the enable-decode gates (s_n, r_n) feed into the loop
// but aren't themselves part of it, so this exercises SCC detection finding
// the one real cycle inside a larger comb subgraph instead of over-flagging.
module d_latch_gated (
  input  logic d,
  input  logic en,
  output logic q,
  output logic qn
);
  logic s_n, r_n;
  assign s_n = ~(d & en);
  assign r_n = ~(~d & en);
  assign q   = ~(s_n & qn);
  assign qn  = ~(r_n & q);
endmodule
