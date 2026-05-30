module nested_case (
    input [1:0] sel_a,
    input [1:0] sel_b,
    input [7:0] data_in1,
    input [7:0] data_in2,
    output logic [7:0] data_out
);

always_comb begin
    case (sel_a)
        2'b00: begin
            case (sel_b)
                2'b00: data_out = data_in1;
                2'b01: data_out = data_in2;
                default: data_out = 8'h00;
            endcase
        end
        2'b01: data_out = 8'hFF;
        default: data_out = 8'hAA;
    endcase
end

endmodule

module nested_case_missing_branch (
    input [1:0] sel_a,
    input [1:0] sel_b,
    input [7:0] in1,
    input [7:0] in2,
    output logic [7:0] out
);

always_comb begin
    out = 8'h00;
    case (sel_a)
        2'b00: begin
            case (sel_b)
                2'b00: out = in1;
                // 2'b01 branch doesn't assign 'out', should use value from outer scope (8'h00)
            endcase
        end
        2'b01: out = in2;
    endcase
end

endmodule

module nested_case_collision (
    input sel_a,
    input sel_b,
    input [7:0] in1,
    input [7:0] in2,
    input [7:0] in3,
    output logic [7:0] out
);

always_comb begin
    case (sel_a)
        1'b0: begin
            case (sel_b)
                1'b0: out = in1;
                1'b1: out = in2;
            endcase
        end
        1'b1: begin
            case (sel_b)
                1'b0: out = in2;
                1'b1: out = in3;
            endcase
        end
    endcase
end

endmodule
