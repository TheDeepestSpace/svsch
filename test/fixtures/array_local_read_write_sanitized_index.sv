module sub_reader #(
    parameter W = 8
) (
    input logic [W-1:0] a,
    output logic [W-1:0] y
);
    assign y = a;
endmodule

module array_local_read_write_sanitized_index #(
    parameter ADDR_WIDTH = 2,
    parameter DATA_WIDTH = 8
) (
    input logic clk,
    input logic mem_write,
    input logic [ADDR_WIDTH-1:0] \addr#sel ,
    input logic [DATA_WIDTH-1:0] write_data,
    output logic [DATA_WIDTH-1:0] read_data,
    output logic [DATA_WIDTH-1:0] read_data2
);
    logic [DATA_WIDTH-1:0] ram [0:(1<<ADDR_WIDTH)-1];

    // The escaped identifier's `#` is not preserved by sanitizeId, so this
    // continuous read and the instance-port read below must resolve to the
    // same sanitized mux id, or the late-pass dedupe misses the duplicate.
    assign read_data = ram[\addr#sel ];

    sub_reader #(.W(DATA_WIDTH)) u_reader (.a(ram[\addr#sel ]), .y(read_data2));

    always_ff @(posedge clk) begin
        if (mem_write) ram[\addr#sel ] <= write_data;
    end
endmodule
