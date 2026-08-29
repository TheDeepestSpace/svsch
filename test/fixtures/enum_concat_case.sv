module enum_concat_case (
  input  logic [2:0] funct3,
  input  logic [1:0] address,
  output logic [3:0] write_enable
);
  typedef enum logic [1:0] {
    BYTE = 2'b00,
    HALF = 2'b01,
    WORD = 2'b10
  } transfersize_t;

  logic [1:0] byte_index;
  transfersize_t transfersize;

  assign byte_index = address;
  assign transfersize = transfersize_t'(funct3[1:0]);

  always_comb
    if (!funct3[2]) write_enable = 4'b0000;
    else
      case ({transfersize, byte_index})
        {BYTE, 2'd0}: write_enable = 4'b0001;
        {BYTE, 2'd1}: write_enable = 4'b0010;
        {BYTE, 2'd2}: write_enable = 4'b0100;
        {BYTE, 2'd3}: write_enable = 4'b1000;
        {HALF, 2'd0}: write_enable = 4'b0011;
        {HALF, 2'd2}: write_enable = 4'b1100;
        {WORD, 2'd0}: write_enable = 4'b1111;
        default:      write_enable = 4'bxxxx;
      endcase
endmodule
