module array_stack_composition_elements (
    input logic [7:0] seed,
    output logic [7:0] arr [0:3]
);
    assign arr[0] = 8'h00;
    assign arr[1] = seed + 8'h01;
    assign arr[2] = seed;
    assign arr[3] = 8'hAB;
endmodule
