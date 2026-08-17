// Regression fixture for: identical case-item labels in unrelated sibling
// case statements must not collide on the same synthesized literal signal
// name. Both sel_inner == 2'b01 arms below must render their own distinct
// constant (4'hA vs 4'hB), not silently share one literal node.
module nested_case_literal_collision (
    input  logic [1:0] sel_outer,
    input  logic [1:0] sel_inner,
    output logic [3:0] out
);

always_comb begin
    case (sel_outer)
        2'b00: case (sel_inner)
                   2'b01: out = 4'hA;
                   default: out = 4'h0;
               endcase
        2'b01: case (sel_inner)
                   2'b01: out = 4'hB;
                   default: out = 4'h0;
               endcase
        default: out = 4'h0;
    endcase
end

endmodule
