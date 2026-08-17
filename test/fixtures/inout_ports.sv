module inout_leaf (
  inout  wire  [7:0] io,
  input  logic       output_enable,
  input  logic [7:0] drive_data,
  output logic [7:0] sampled_data
);
  assign io = output_enable ? drive_data : 8'hzz;
  assign sampled_data = io;
endmodule

module inout_ports (
  inout  wire  [7:0] external_bus,
  input  logic       output_enable,
  input  logic [7:0] drive_data,
  output logic [7:0] sampled_data
);
  inout_leaf u_leaf (
    .io            (external_bus),
    .output_enable (output_enable),
    .drive_data    (drive_data),
    .sampled_data  (sampled_data)
  );
endmodule
