module enum_concat_case_top (
  input  logic [2:0] funct3,
  input  logic [1:0] address,
  output logic [3:0] write_enable
);
  enum_concat_case u_decode (
    .funct3,
    .address,
    .write_enable
  );
endmodule
