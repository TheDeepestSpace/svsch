module register_clock_enable(
    input logic clk,
    input logic rst,
    input logic en,
    input logic d,
    output logic q
);
    always_ff @(posedge clk or posedge rst) begin
        if (rst) q <= 1'b0;
        else if (en) q <= d;
    end
endmodule
