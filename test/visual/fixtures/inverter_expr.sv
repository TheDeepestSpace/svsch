typedef struct packed {
  logic x;
  logic y;
} pair_t;

module inverter_expr (
  input logic a,
  input logic [3:0] bus,
  input pair_t s,
  output logic y,
  output logic [3:0] bus_y,
  output pair_t s_y
);
  assign y = ~a;
  assign bus_y = ~bus;
  assign s_y = ~s;
endmodule
