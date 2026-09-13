module single_signal_unmatched_clock(input logic trigger, input logic d, output logic q);
  always_ff @(posedge trigger) begin
    q <= d;
  end
endmodule
