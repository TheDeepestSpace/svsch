module array_address_read (
    input logic [1:0] address,
    input logic [7:0] M [0:3],
    output logic [7:0] read_data
);
    assign read_data = M[address];
endmodule
