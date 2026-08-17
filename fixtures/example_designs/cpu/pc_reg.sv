module pc_reg #(
  parameter WIDTH = 8
) (
  input  logic             clk,
  input  logic             reset_n,
  input  logic [WIDTH-1:0] next_pc,
  output logic [WIDTH-1:0] pc
);

  always_ff @(posedge clk or negedge reset_n) begin
    if (!reset_n) begin
      pc <= '0;
    end else begin
      pc <= next_pc;
    end
  end

endmodule
