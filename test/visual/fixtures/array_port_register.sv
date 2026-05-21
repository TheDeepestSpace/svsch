module array_port_register (
    input logic clk,
    input logic [7:0] in_data [0:3],
    output logic [7:0] out_data [0:3]
);
    logic [7:0] storage [0:3];

    always_ff @(posedge clk) begin
        storage <= in_data;
    end

    assign out_data = storage;
endmodule
