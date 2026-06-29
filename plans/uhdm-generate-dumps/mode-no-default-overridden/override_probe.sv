module leaf(input logic a, output logic y);
  assign y = a;
endmodule

module child #(parameter int MODE) (
  input logic a,
  input logic b,
  output logic y
);
  logic w_case;

  generate
    case (MODE)
      0: begin : g_case_0
        leaf u_c0(.a(a), .y(w_case));
      end
      1, 2: begin : g_case_12
        leaf u_c12(.a(b), .y(w_case));
      end
      default: begin : g_case_default
        assign w_case = 1'b0;
      end
    endcase
  endgenerate

  assign y = w_case;
endmodule

module wrapper(input logic a, input logic b, output logic y);
  child #(.MODE(2)) u_child(.a(a), .b(b), .y(y));
endmodule
