module array_stack_composition_literal_1bit (
    output logic arr [0:3]
);
    always_comb begin
        arr = '{1'b1, 1'b0, 1'b1, 1'b0};
    end
endmodule
