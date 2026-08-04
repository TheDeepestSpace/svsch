module cpu_top (
  input  logic       clk,
  input  logic       reset_n,
  output logic [7:0] pc_out,
  output logic [7:0] instr_out,
  output logic [7:0] alu_result_out
);

  logic [7:0] pc;
  logic [7:0] next_pc;
  logic [7:0] pc_plus_1;
  logic [7:0] branch_target;

  logic [7:0] instr;
  logic [7:0] imm;

  logic       reg_write;
  logic       alu_src;
  logic [2:0] alu_op;
  logic       mem_write;
  logic       mem_to_reg;
  logic       branch;
  logic       jump;

  logic [7:0] rs1_data;
  logic [7:0] rs2_data;
  logic [7:0] alu_in_b;
  logic [7:0] alu_result;
  logic       alu_zero;

  logic [7:0] mem_read_data;
  logic [7:0] reg_write_data;

  logic       pc_src;

  // Program Counter (8-bit)
  pc_reg #(.WIDTH(8)) u_pc_reg (
    .clk     (clk),
    .reset_n (reset_n),
    .next_pc (next_pc),
    .pc      (pc)
  );

  // PC + 1 Adder
  adder #(.WIDTH(8)) u_pc_adder (
    .a   (pc),
    .b   (8'd1),
    .sum (pc_plus_1)
  );

  // Instruction Memory
  instr_mem #(.ADDR_WIDTH(8), .DATA_WIDTH(8)) u_instr_mem (
    .addr  (pc),
    .instr (instr)
  );

  // Control Unit
  control_unit u_control_unit (
    .opcode     (instr[7:4]),
    .reg_write  (reg_write),
    .alu_src    (alu_src),
    .alu_op     (alu_op),
    .mem_write  (mem_write),
    .mem_to_reg (mem_to_reg),
    .branch     (branch),
    .jump       (jump)
  );

  // Register File (4 registers, 8-bit data width)
  register_file #(.DATA_WIDTH(8), .REG_ADDR_WIDTH(2)) u_register_file (
    .clk        (clk),
    .reset_n    (reset_n),
    .reg_write  (reg_write),
    .rs1_addr   (instr[3:2]),
    .rs2_addr   (instr[1:0]),
    .rd_addr    (instr[3:2]),
    .write_data (reg_write_data),
    .rs1_data   (rs1_data),
    .rs2_data   (rs2_data)
  );

  // Immediate Generator
  imm_gen #(.DATA_WIDTH(8)) u_imm_gen (
    .instr (instr),
    .imm   (imm)
  );

  // Branch Target Adder
  adder #(.WIDTH(8)) u_branch_adder (
    .a   (pc),
    .b   (imm),
    .sum (branch_target)
  );

  // ALU Source Mux
  mux2 #(.WIDTH(8)) u_alu_src_mux (
    .d0  (rs2_data),
    .d1  (imm),
    .sel (alu_src),
    .y   (alu_in_b)
  );

  // Arithmetic Logic Unit
  alu #(.DATA_WIDTH(8)) u_alu (
    .a      (rs1_data),
    .b      (alu_in_b),
    .alu_op (alu_op),
    .result (alu_result),
    .zero   (alu_zero)
  );

  // Data Memory
  data_mem #(.ADDR_WIDTH(8), .DATA_WIDTH(8)) u_data_mem (
    .clk        (clk),
    .mem_write  (mem_write),
    .addr       (alu_result),
    .write_data (rs2_data),
    .read_data  (mem_read_data)
  );

  // Memory to Register Writeback Mux
  mux2 #(.WIDTH(8)) u_mem_to_reg_mux (
    .d0  (alu_result),
    .d1  (mem_read_data),
    .sel (mem_to_reg),
    .y   (reg_write_data)
  );

  // Next PC Mux logic
  assign pc_src = (branch & alu_zero) | jump;

  mux2 #(.WIDTH(8)) u_pc_src_mux (
    .d0  (pc_plus_1),
    .d1  (branch_target),
    .sel (pc_src),
    .y   (next_pc)
  );

  // Output assignments
  assign pc_out         = pc;
  assign instr_out      = instr;
  assign alu_result_out = alu_result;

endmodule
