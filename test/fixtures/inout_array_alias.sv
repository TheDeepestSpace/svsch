module inout_array_alias (
  input  logic [7:0] drive_enable [0:1],
  inout  wire  [7:0] a [0:1],
  output logic [7:0] y [0:1]
);
  assign a[0] = drive_enable[0] ? 8'hff : 8'hzz;
  assign a[1] = drive_enable[1] ? 8'hff : 8'hzz;
  assign y = a;
endmodule
