module array_address_write_enable_register (
    input logic clk,
    input logic write_en,
    input logic [1:0] address,
    input logic [7:0] in_data,
    output logic [7:0] out_data [0:3]
);
    logic [7:0] storage [0:3];

    always_ff @(posedge clk) begin
        if (write_en)
            storage[address] <= in_data;
    end

    assign out_data = storage;
endmodule
