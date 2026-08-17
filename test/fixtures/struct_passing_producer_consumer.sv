typedef struct packed {
  logic [3:0] a;
  logic b;
} my_struct_t;

module producer(
  output my_struct_t out_struct
);
  assign out_struct.a = 4'hA;
  assign out_struct.b = 1'b1;
endmodule

module consumer(
  input my_struct_t in_struct,
  output logic [3:0] a_out,
  output logic b_out
);
  assign a_out = in_struct.a;
  assign b_out = in_struct.b;
endmodule

module top(
  output logic [3:0] a,
  output logic b
);
  my_struct_t s;
  producer p(s);
  consumer c(s, a, b);
endmodule
