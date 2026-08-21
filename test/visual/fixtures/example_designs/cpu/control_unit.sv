module control_unit (
  input  logic [3:0] opcode,
  output logic       reg_write,
  output logic       alu_src,
  output logic [2:0] alu_op,
  output logic       mem_write,
  output logic       mem_to_reg,
  output logic       branch,
  output logic       jump
);

  always_comb begin
    reg_write  = 1'b0;
    alu_src    = 1'b0;
    alu_op     = 3'b000;
    mem_write  = 1'b0;
    mem_to_reg = 1'b0;
    branch     = 1'b0;
    jump       = 1'b0;

    case (opcode)
      4'b0000: begin // ADD rA, rB
        reg_write = 1'b1;
        alu_src   = 1'b0;
        alu_op    = 3'b000;
      end

      4'b0001: begin // SUB rA, rB
        reg_write = 1'b1;
        alu_src   = 1'b0;
        alu_op    = 3'b001;
      end

      4'b0010: begin // AND rA, rB
        reg_write = 1'b1;
        alu_src   = 1'b0;
        alu_op    = 3'b010;
      end

      4'b0011: begin // OR rA, rB
        reg_write = 1'b1;
        alu_src   = 1'b0;
        alu_op    = 3'b011;
      end

      4'b0100: begin // ADDI rA, imm
        reg_write = 1'b1;
        alu_src   = 1'b1;
        alu_op    = 3'b000;
      end

      4'b0101: begin // LOAD rA, [rB]
        reg_write  = 1'b1;
        mem_to_reg = 1'b1;
        alu_op     = 3'b000;
      end

      4'b0110: begin // STORE rA, [rB]
        mem_write = 1'b1;
        alu_op    = 3'b000;
      end

      4'b0111: begin // BEQ rA, rB, offset
        branch = 1'b1;
        alu_op = 3'b001; // SUB for comparison
      end

      4'b1000: begin // JUMP target
        jump = 1'b1;
      end

      default: ;
    endcase
  end

endmodule
