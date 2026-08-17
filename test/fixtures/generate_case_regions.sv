module generate_case_leaf(input logic a, output logic y);
  assign y = a;
endmodule

module generate_case_regions #(
  parameter MODE = 1
) (
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  logic w;

  generate
    case (MODE)
      0: begin : g_case_0
        generate_case_leaf u_case_0(.a(a), .y(w));
      end
      1: begin : g_case_1
        generate_case_leaf u_case_1(.a(b), .y(w));
      end
      default: begin
        assign w = c;
      end
    endcase
  endgenerate

  assign y = w;
endmodule
