interface param_status_if #(
  parameter WIDTH = 8
)(
  input logic clk
);
  logic [WIDTH-1:0] level;
  logic              alert;

  modport source(input clk, output level, output alert);
  modport sink(input clk, input level, input alert);
endinterface

module param_bus_breakout #(
  parameter DATA_WIDTH = 8
)(
  input  logic [DATA_WIDTH-1:0] data_i,
  output logic [3:0]            hi_o,
  output logic [3:0]            lo_o
);
  assign hi_o = data_i[7:4];
  assign lo_o = data_i[3:0];
endmodule

module param_bus_composition #(
  parameter DATA_WIDTH = 8
)(
  input  logic [11:0]           instr,
  output logic [DATA_WIDTH-1:0] imm
);
  always_comb begin
    imm = {{(DATA_WIDTH-4){instr[3]}}, instr[3:0]};
  end
endmodule

module param_status_source #(
  parameter WIDTH = 16
)(
  param_status_if.source bus,
  input  logic [15:0]     level_i
);
  assign bus.level = level_i;
  assign bus.alert = |level_i;
endmodule

module param_status_sink #(
  parameter WIDTH = 16
)(
  param_status_if.sink bus,
  output logic [7:0] hi_o,
  output logic [7:0] lo_o
);
  assign hi_o = bus.level[15:8];
  assign lo_o = bus.level[7:0];
endmodule

module param_bus_interface(
  input  logic        clk,
  input  logic [15:0] level_i,
  output logic [7:0]  hi_o,
  output logic [7:0]  lo_o
);
  param_status_if #(.WIDTH(16)) status(clk);

  param_status_source #(.WIDTH(16)) u_source(.bus(status), .level_i(level_i));
  param_status_sink   #(.WIDTH(16)) u_sink(.bus(status), .hi_o(hi_o), .lo_o(lo_o));
endmodule
