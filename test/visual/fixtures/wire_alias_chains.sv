module wire_no_alias(input logic a, output logic y);
  assign y = a;
endmodule

module wire_single_alias(input logic a, output logic y);
  wire x;
  assign x = a;
  assign y = x;
endmodule

module wire_multiple_aliases(input logic a, output logic y);
  wire x1, x2;
  assign x1 = a;
  assign x2 = x1;
  assign y = x2;
endmodule
