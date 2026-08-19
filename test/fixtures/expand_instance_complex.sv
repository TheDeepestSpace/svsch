typedef struct packed {
  logic [7:0] lo;
  logic [7:0] hi;
} word_t;

// Child module with several internal nodes (two registers, two combs) and
// styled ports: a multi-bit bus, a packed-struct port, and plain scalars —
// exercising the boundary-port lead styling and internal-wire containment
// of "Expand instance in place" (issue #232).
module datapath(
  input  logic clk,
  input  logic [7:0] bus_in,
  input  word_t pkt_in,
  output logic [7:0] bus_out,
  output logic flag
);
  logic [7:0] stage;
  word_t held;

  always_ff @(posedge clk) begin
    stage <= bus_in;
    held  <= pkt_in;
  end

  assign bus_out = stage ^ held.lo;
  assign flag = ^held.hi;
endmodule

module top(
  input  logic clk,
  input  logic [7:0] bus_in,
  input  word_t pkt_in,
  output logic [7:0] bus_out,
  output logic flag
);
  datapath u_dp(
    .clk(clk),
    .bus_in(bus_in),
    .pkt_in(pkt_in),
    .bus_out(bus_out),
    .flag(flag)
  );
endmodule
