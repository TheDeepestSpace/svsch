typedef struct packed {
    logic [7:0] a;
    logic [7:0] b;
} my_struct_t;

module struct_mux (
    input sel,
    input my_struct_t in1,
    input my_struct_t in2,
    output my_struct_t out
);

// Using a slightly more complex expression to force promotion to a comb node
assign out = (sel) ? in1 : in2;

endmodule

module struct_complex (
    input sel,
    input my_struct_t in1,
    input my_struct_t in2,
    output my_struct_t out
);

// Complex expression that is NOT a mux but results in a struct
// (Packed structs can be XORed)
assign out = in1 ^ in2;

endmodule
