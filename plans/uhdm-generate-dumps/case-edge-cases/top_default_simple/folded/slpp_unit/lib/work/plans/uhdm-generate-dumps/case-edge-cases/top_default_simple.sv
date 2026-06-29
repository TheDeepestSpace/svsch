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
      0: begin : g_case_0
        leaf u_c0(.a(a), .y(w_case));
      end
      1: begin : g_case_1
        leaf u_c1(.a(b), .y(w_case));
      end
      2: begin : g_case_2
        leaf u_c2(.a(c), .y(w_case));
      end
      default: begin : g_case_default
        assign w_case = 1'b0;
      end
    endcase
  endgenerate

  assign y = w_case;
endmodule
