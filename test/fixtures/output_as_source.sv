typedef struct packed {
    logic [3:0] b;
} struct_t;

module output_as_source (
    input struct_t a,
    output logic [3:0] c
);

    assign c = a.b;

    wire [1:0] i;
    assign i = c[1:0];

    // Some dummy consumer for i
    logic [1:0] r;
    always_ff @(posedge a.b[0]) r <= i;

endmodule
