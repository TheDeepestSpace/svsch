module register_file #(
  parameter DATA_WIDTH = 8,
  parameter REG_ADDR_WIDTH = 2
) (
  input  logic                     clk,
  input  logic                     reset_n,
  input  logic                     reg_write,
  input  logic [REG_ADDR_WIDTH-1:0] rs1_addr,
  input  logic [REG_ADDR_WIDTH-1:0] rs2_addr,
  input  logic [REG_ADDR_WIDTH-1:0] rd_addr,
  input  logic [DATA_WIDTH-1:0]     write_data,
  output logic [DATA_WIDTH-1:0]     rs1_data,
  output logic [DATA_WIDTH-1:0]     rs2_data
);

  logic [DATA_WIDTH-1:0] regs [0:(1<<REG_ADDR_WIDTH)-1];

  assign rs1_data = (rs1_addr == '0) ? '0 : regs[rs1_addr];
  assign rs2_data = (rs2_addr == '0) ? '0 : regs[rs2_addr];

  always_ff @(posedge clk or negedge reset_n) begin
    if (!reset_n) begin
      for (int i = 0; i < (1<<REG_ADDR_WIDTH); i++) begin
        regs[i] <= '0;
      end
    end else if (reg_write && (rd_addr != '0)) begin
      regs[rd_addr] <= write_data;
    end
  end

endmodule
