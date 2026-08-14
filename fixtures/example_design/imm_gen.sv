module imm_gen #(
  parameter DATA_WIDTH = 8
) (
  input  logic [11:0]           instr,
  output logic [DATA_WIDTH-1:0] imm
);

  always_comb begin
    case (instr[11:8])
      4'b0100: // ADDI: 4-bit immediate in instr[3:0]
        imm = {{(DATA_WIDTH-4){instr[3]}}, instr[3:0]};

      4'b0111: // BEQ: 4-bit offset in instr[3:0]
        imm = {{(DATA_WIDTH-4){instr[3]}}, instr[3:0]};

      4'b1000: // JUMP: 4-bit target in instr[3:0]
        imm = {{(DATA_WIDTH-4){1'b0}}, instr[3:0]};

      default:
        imm = '0;
    endcase
  end

endmodule
