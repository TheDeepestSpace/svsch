module sr_latch(input logic s, input logic r, output logic q);
  always_comb begin
    case ({s, r})
      2'b10: q = 1'b1;
      2'b01: q = 1'b0;
    endcase
  end
endmodule
