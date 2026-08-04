module imm_gen #(
  parameter DATA_WIDTH = 8
) (
  input  logic [7:0]            instr,
  output logic [DATA_WIDTH-1:0] imm
);

  always_comb begin
    case (instr[7:4])
      4'b0100: // ADDI: 4-bit immediate in instr[3:0]
        imm = {{4{instr[3]}}, instr[3:0]};

      4'b0111: // BEQ: 4-bit offset in instr[3:0]
        imm = {{4{instr[3]}}, instr[3:0]};

      4'b1000: // JUMP: 4-bit target in instr[3:0]
        imm = {4'b0000, instr[3:0]};

      default:
        imm = '0;
    endcase
  end

endmodule
