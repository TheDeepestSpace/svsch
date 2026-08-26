// A 10-level instantiation chain (nest_top -> nest_level9 -> ... -> nest_level1
// -> nest_level0) used by the system test that expands every level in place
// down to the innermost AND gate. Each wrapper module passes its two inputs
// and one output straight through a single instance named "u_inner", so the
// same node label works for every level.
module nest_level0(input logic a, input logic b, output logic y);
  assign y = a & b;
endmodule

module nest_level1(input logic a, input logic b, output logic y);
  nest_level0 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_level2(input logic a, input logic b, output logic y);
  nest_level1 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_level3(input logic a, input logic b, output logic y);
  nest_level2 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_level4(input logic a, input logic b, output logic y);
  nest_level3 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_level5(input logic a, input logic b, output logic y);
  nest_level4 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_level6(input logic a, input logic b, output logic y);
  nest_level5 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_level7(input logic a, input logic b, output logic y);
  nest_level6 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_level8(input logic a, input logic b, output logic y);
  nest_level7 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_level9(input logic a, input logic b, output logic y);
  nest_level8 u_inner(.a(a), .b(b), .y(y));
endmodule

module nest_top(input logic a, input logic b, output logic y);
  nest_level9 u_inner(.a(a), .b(b), .y(y));
endmodule
