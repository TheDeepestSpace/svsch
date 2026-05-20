module array_register (
    input logic clk,
    input logic rst,
    input logic write_en,
    input logic [2:0] address,
    input logic [31:0] write_data,
    output logic [31:0] read_data
);
    logic [31:0] M [0:7];

    always_ff @(posedge clk or posedge rst) begin
        if (rst) M[address] <= 32'b0;
        else if (write_en) M[address] <= write_data;
    end

    assign read_data = M[address];
endmodule
