typedef struct packed {
  logic x;
  logic y;
} pair_t;

module inverter_expr (
  input logic a,
  input logic [3:0] bus,
  input pair_t s,
  input logic n_valid,
  input logic [3:0] bus4,
  output logic y,
  output logic [3:0] bus_y,
  output pair_t s_y,
  output logic valid_out,
  output logic is_nonzero
);
  assign y         = ~a;
  assign bus_y     = ~bus;
  assign s_y       = ~s;
  assign valid_out = !n_valid;   // 1-bit !  → inverter
  assign is_nonzero = !bus4;     // 4-bit !  → comb (zero-test reduction)
endmodule
