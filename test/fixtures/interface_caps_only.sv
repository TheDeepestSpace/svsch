interface caps_only_if(input logic clk, output logic done);
  assign done = clk;
endinterface

module interface_caps_only(input logic clk, output logic done);
  caps_only_if status(clk, done);
endmodule
