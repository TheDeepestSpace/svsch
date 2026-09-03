// Single-node structural feedback: a mux whose own output feeds back into one
// of its data inputs (the "hold" input of a transparent latch), rather than a
// multi-gate cycle like the cross-coupled SR latches.
module mux_hold_loop (
  input  logic en,
  input  logic d,
  output logic q
);
  assign q = en ? d : q;
endmodule
