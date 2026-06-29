module leaf(input logic a, output logic y);
  assign y = a;
endmodule

module top #(parameter int USE_A = 1, parameter int MODE) (
  input logic a,
  input logic b,
  output logic y
);
  logic w_if;
  logic w_case;

  generate
    if (USE_A) begin : g_if_a
      leaf u_a(.a(a), .y(w_if));
    end else begin : g_if_b
      leaf u_b(.a(b), .y(w_if));
    end

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

  if (USE_A) begin : g_imp_true
    assign y = w_if & w_case;
  end else begin : g_imp_false
    assign y = w_case;
  end
endmodule
