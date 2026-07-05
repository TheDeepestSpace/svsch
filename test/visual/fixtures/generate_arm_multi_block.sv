module generate_arm_multi_block_leaf (
    input  logic a,
    output logic y
);
  assign y = a;
endmodule

module generate_arm_multi_block_top #(
    parameter MODE = 1
) (
    input  logic a,
    input  logic b,
    input  logic c,
    input  logic sel,
    output logic y
);
  generate
    if (MODE == 1) begin : g_if_one
      logic left_tap;
      logic right_tap;

      generate_arm_multi_block_leaf u_path_a (
          .a(a),
          .y(left_tap)
      );
      generate_arm_multi_block_leaf u_path_b (
          .a(b),
          .y(right_tap)
      );
      assign y = sel ? left_tap : right_tap;
    end else begin : g_if_other
      generate_arm_multi_block_leaf u_other (
          .a(c),
          .y(y)
      );
    end
  endgenerate
endmodule
