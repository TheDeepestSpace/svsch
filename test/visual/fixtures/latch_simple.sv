module latch_simple(input logic en, input logic [3:0] d, output logic [3:0] q);
  always_comb begin
    if (en) q = d;
  end
endmodule
