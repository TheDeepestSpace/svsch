module inout_mux_array (
  input  logic       drive_enable,
  input  logic [7:0] drive_data,
  inout  wire  [7:0] a,
  output logic [7:0] y
);
  assign a = drive_enable ? drive_data : 8'hzz;
  assign y = a;
endmodule
