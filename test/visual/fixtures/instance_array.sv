module mux2 (
    input  logic sel,
    input  logic a,
    input  logic b,
    output logic y
);
    assign y = sel ? b : a;
endmodule

module instance_array_top (
    input  logic sel,
    input  logic [3:0] a_bus,
    input  logic [3:0] b_bus,
    output logic [3:0] y_bus
);
    logic a_arr [3:0];
    logic b_arr [3:0];
    logic y_arr [3:0];

    assign a_arr[0] = a_bus[0];
    assign a_arr[1] = a_bus[1];
    assign a_arr[2] = a_bus[2];
    assign a_arr[3] = a_bus[3];

    assign b_arr[0] = b_bus[0];
    assign b_arr[1] = b_bus[1];
    assign b_arr[2] = b_bus[2];
    assign b_arr[3] = b_bus[3];

    mux2 u_mux [3:0] (
        .sel (sel),
        .a   (a_arr),
        .b   (b_arr),
        .y   (y_arr)
    );

    assign y_bus[0] = y_arr[0];
    assign y_bus[1] = y_arr[1];
    assign y_bus[2] = y_arr[2];
    assign y_bus[3] = y_arr[3];
endmodule
