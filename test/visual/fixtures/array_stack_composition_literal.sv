module array_stack_composition_literal (
    output logic [7:0] arr [0:3]
);
    always_comb begin
        arr = '{8'hAB, 8'hCD, 8'hEF, 8'h00};
    end
endmodule
