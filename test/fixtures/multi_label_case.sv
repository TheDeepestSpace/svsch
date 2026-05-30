module multi_label_case (
    input [1:0] sel,
    input [7:0] in1,
    input [7:0] in2,
    output logic [7:0] out
);

always_comb begin
    case (sel)
        2'b00, 2'b01: out = in1;
        2'b10:        out = in2;
        default:      out = 8'h00;
    endcase
end

endmodule
