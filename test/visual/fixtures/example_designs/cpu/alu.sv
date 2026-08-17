module alu #(
  parameter DATA_WIDTH = 8
) (
  input  logic [DATA_WIDTH-1:0] a,
  input  logic [DATA_WIDTH-1:0] b,
  input  logic [2:0]            alu_op,
  output logic [DATA_WIDTH-1:0] result,
  output logic                  zero
);

  always_comb begin
    case (alu_op)
      3'b000:  result = a + b;                  // ADD
      3'b001:  result = a - b;                  // SUB
      3'b010:  result = a & b;                  // AND
      3'b011:  result = a | b;                  // OR
      3'b100:  result = (a < b) ? 8'b1 : 8'b0;  // SLT
      default: result = '0;
    endcase
  end

  assign zero = (result == '0);

endmodule
