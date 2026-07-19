module array_port_register_bit (
    input logic clk,
    input logic in_flag [0:3],
    output logic out_flag [0:3]
);
    logic flags [0:3];

    always_ff @(posedge clk) begin
        flags <= in_flag;
    end

    assign out_flag = flags;
endmodule
