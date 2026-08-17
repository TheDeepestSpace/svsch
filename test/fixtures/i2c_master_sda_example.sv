module i2c_master_sda_example (
  input  wire clk,
  input  wire sda_mode,       // 1 = Master writes to bus, 0 = Master reads from bus
  input  wire bit_to_send,    // The data bit the master wants to transmit (0 or 1)
  output reg  ack_received,   // Variable to store the sampled ACK bit from the slave
  inout  wire sda             // The physical, bidirectional I2C data line
);

  // I2C Open-Drain Drive Logic:
  // If master is writing and wants to send a '0', it pulls the line to 0.
  // If master wants to send a '1' (or is in read/ACK mode), it releases the line (z).
  // An external pull-up resistor on the board brings 'z' up to a physical '1'.
  assign sda = (sda_mode == 1'b1 && bit_to_send == 1'b0) ? 1'b0 : 1'bz;

  // Sampling Logic (Reading from the bus):
  always @(posedge clk) begin
    // When master is reading (e.g., waiting for an ACK from the slave device)
    if (sda_mode == 1'b0) begin
      ack_received <= sda; // Read the state driven by the slave
    end
  end

endmodule
