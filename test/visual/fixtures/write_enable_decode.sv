module write_enable_decode (
  input  logic [1:0] transfersize,
  input  logic [1:0] byte_index,
  output logic [3:0] mem_write_enable
);
  localparam logic [1:0] BYTE = 2'b00;
  localparam logic [1:0] HALF = 2'b01;
  localparam logic [1:0] WORD = 2'b10;

  always_comb begin
    case ({transfersize, byte_index})
      {BYTE, 2'd0}: mem_write_enable = 4'b0001;
      {BYTE, 2'd1}: mem_write_enable = 4'b0010;
      {BYTE, 2'd2}: mem_write_enable = 4'b0100;
      {BYTE, 2'd3}: mem_write_enable = 4'b1000;
      {HALF, 2'd0}: mem_write_enable = 4'b0011;
      {HALF, 2'd2}: mem_write_enable = 4'b1100;
      {WORD, 2'd0}: mem_write_enable = 4'b1111;
      default:      mem_write_enable = 4'bxxxx;
    endcase
  end
endmodule
