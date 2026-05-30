module nested_if_clocked (
    input logic clk,
    input logic sel,
    input logic [7:0] in1,
    output logic [7:0] out
);

always_ff @(posedge clk) begin
    if (sel) out <= in1;
end

endmodule
