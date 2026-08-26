module aggregate_assignment_branches (
  input  logic       clk,
  input  logic       rst,
  input  logic       flush,
  input  logic       load_en,
  input  logic       hold_en,
  input  logic [7:0] din,
  output logic [7:0] data_reg,
  output logic       data_valid
);
  always_ff @(posedge clk) begin
    if (rst)
      {data_reg, data_valid} <= {8'd0, 1'b0};
    else if (flush)
      {data_reg, data_valid} <= {data_reg, 1'b0};
    else if (load_en && !data_valid)
      {data_reg, data_valid} <= {din, 1'b1};
    else if (hold_en && data_valid)
      {data_reg, data_valid} <= {data_reg, 1'b0};
  end
endmodule
