module wire_selector (
    input [31:0] instruction,
    input [7:0] data_in1,
    input [7:0] data_in2,
    output logic [7:0] data_out
);

wire [6:0] opcode = instruction[6:0];

always_comb begin
    case (opcode)
        7'h01:   data_out = data_in1;
        7'h02:   data_out = data_in2;
        default: data_out = 8'h00;
    endcase
end

endmodule

module procedural_selector (
    input [31:0] instruction,
    input [7:0] data_in1,
    input [7:0] data_in2,
    output logic [7:0] data_out
);

always_comb begin
    logic [6:0] opcode;
    opcode = instruction[6:0];
    case (opcode)
        7'h01:   data_out = data_in1;
        7'h02:   data_out = data_in2;
        default: data_out = 8'h00;
    endcase
end

endmodule
