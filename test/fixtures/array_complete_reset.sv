module array_complete_reset (
    input logic clk,
    input logic rst,
    input logic [31:0] in_data [0:7],
    output logic [31:0] out_data [0:7]
);
    logic [31:0] arr [0:7];

    always_ff @(posedge clk or posedge rst) begin
        if (rst) arr <= '{default: 32'b0};
        else arr <= in_data;
    end

    assign out_data = arr;
endmodule
