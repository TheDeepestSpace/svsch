module array_stack_breakout (
    input logic [7:0] arr [0:3],
    output logic [7:0] elem0,
    output logic [7:0] elem1,
    output logic [7:0] elem2,
    output logic [7:0] elem3
);
    assign elem0 = arr[0];
    assign elem1 = arr[1];
    assign elem2 = arr[2];
    assign elem3 = arr[3];
endmodule
