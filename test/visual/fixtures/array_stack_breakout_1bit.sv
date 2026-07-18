module array_stack_breakout_1bit (
    input logic arr [0:3],
    output logic elem0,
    output logic elem1,
    output logic elem2,
    output logic elem3
);
    assign elem0 = arr[0];
    assign elem1 = arr[1];
    assign elem2 = arr[2];
    assign elem3 = arr[3];
endmodule
