module leaf(input logic a, output logic y);
  assign y = a;
endmodule

module nested_if_if #(
  parameter int OUTER = 1,
  parameter int INNER = 0
) (
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  logic w;

  generate
    if (OUTER) begin : g_outer_true
      if (INNER) begin : g_inner_true
        leaf u_inner_true(.a(a), .y(w));
      end else begin : g_inner_false
        leaf u_inner_false(.a(b), .y(w));
      end
    end else begin : g_outer_false
      leaf u_outer_false(.a(c), .y(w));
    end
  endgenerate

  assign y = w;
endmodule

module nested_case_case #(
  parameter int OUTER_MODE = 1,
  parameter int INNER_MODE = 2
) (
  input logic a,
  input logic b,
  input logic c,
  input logic d,
  output logic y
);
  logic w;

  generate
    case (OUTER_MODE)
      0: begin : g_outer_0
        case (INNER_MODE)
          0: begin : g_inner_0
            leaf u_inner_0(.a(a), .y(w));
          end
          default: begin : g_inner_default_from_0
            leaf u_inner_default_from_0(.a(b), .y(w));
          end
        endcase
      end
      1: begin : g_outer_1
        case (INNER_MODE)
          2: begin : g_inner_2
            leaf u_inner_2(.a(c), .y(w));
          end
          default: begin : g_inner_default_from_1
            leaf u_inner_default_from_1(.a(d), .y(w));
          end
        endcase
      end
      default: begin : g_outer_default
        assign w = 1'b0;
      end
    endcase
  endgenerate

  assign y = w;
endmodule

module nested_if_case #(
  parameter int ENABLE = 1,
  parameter int MODE = 0
) (
  input logic a,
  input logic b,
  input logic c,
  output logic y
);
  logic w;

  generate
    if (ENABLE) begin : g_if_on
      case (MODE)
        0: begin : g_case_0
          leaf u_case_0(.a(a), .y(w));
        end
        default: begin : g_case_default
          leaf u_case_default(.a(b), .y(w));
        end
      endcase
    end else begin : g_if_off
      leaf u_if_off(.a(c), .y(w));
    end
  endgenerate

  assign y = w;
endmodule

module nested_case_if #(
  parameter int MODE = 0,
  parameter int ENABLE = 1
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
        if (ENABLE) begin : g_if_yes
          leaf u_if_yes(.a(a), .y(w));
        end else begin : g_if_no
          leaf u_if_no(.a(b), .y(w));
        end
      end
      default: begin : g_case_default
        leaf u_case_default(.a(c), .y(w));
      end
    endcase
  endgenerate

  assign y = w;
endmodule

module wrapper(
  input logic a,
  input logic b,
  input logic c,
  input logic d,
  output logic y_if_if,
  output logic y_case_case,
  output logic y_if_case,
  output logic y_case_if
);
  nested_if_if #(.OUTER(1), .INNER(0)) u_if_if(
    .a(a), .b(b), .c(c), .y(y_if_if)
  );

  nested_case_case #(.OUTER_MODE(1), .INNER_MODE(2)) u_case_case(
    .a(a), .b(b), .c(c), .d(d), .y(y_case_case)
  );

  nested_if_case #(.ENABLE(1), .MODE(0)) u_if_case(
    .a(a), .b(b), .c(c), .y(y_if_case)
  );

  nested_case_if #(.MODE(0), .ENABLE(1)) u_case_if(
    .a(a), .b(b), .c(c), .y(y_case_if)
  );
endmodule
