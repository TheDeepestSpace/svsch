module generate_arm_intrusion_leaf (
    input  logic a,
    output logic y
);
  assign y = a;
endmodule

module generate_arm_intrusion #(
    parameter MODE = 1
) (
    input  logic a,
    input  logic b,
    output logic y,
    output logic z
);
  logic w;

  generate_arm_intrusion_leaf u_free (
      .a(a),
      .y(z)
  );

  generate
    if (MODE == 1) begin : g_arm
      generate_arm_intrusion_leaf u_arm (
          .a(b),
          .y(w)
      );
    end
  endgenerate

  assign y = w;
endmodule
