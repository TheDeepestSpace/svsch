module leaf(input logic a, output logic y);
  assign y = a;
endmodule

module generate_regions #(
  parameter MODE = 1,
  parameter ENABLE = 1
) (
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  logic w;

  generate
    if (ENABLE == 0) begin : g_if_zero
      leaf u_zero(.a(a), .y(w));
    end else if (ENABLE == 1) begin : g_if_one
      case (MODE)
        0: begin : g_case_0
          leaf u_case_0(.a(a), .y(w));
        end
        1: begin : g_case_1
          leaf u_case_1(.a(b), .y(w));
        end
        default: begin : g_case_default
          assign w = c;
        end
      endcase
    end else begin : g_if_other
      assign w = 1'b0;
    end
  endgenerate

  assign y = w;
endmodule
