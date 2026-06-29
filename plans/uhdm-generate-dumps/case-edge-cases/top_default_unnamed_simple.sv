module leaf(input logic a, output logic y);
  assign y = a;
endmodule

module top #(parameter int MODE = 2) (
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  logic w_case;

  generate
    case (MODE)
      0: leaf u_c0(.a(a), .y(w_case));
      1: leaf u_c1(.a(b), .y(w_case));
      2: leaf u_c2(.a(c), .y(w_case));
      default: assign w_case = 1'b0;
    endcase
  endgenerate

  assign y = w_case;
endmodule
