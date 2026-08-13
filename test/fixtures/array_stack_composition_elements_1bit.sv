module array_stack_composition_elements_1bit (
    input logic seed,
    output logic arr [0:3]
);
    assign arr[0] = 1'b0;
    assign arr[1] = ~seed;
    assign arr[2] = seed;
    assign arr[3] = 1'b1;
endmodule
