Feature: CLI SVG export

  Scenario: CLI render reflects edits made in an open module
    Given I have opened "top.sv" for editing with:
      """sv
      module top(
        input logic clk,
        input logic d,
        output logic q
      );
        logic old_state;

        always_ff @(posedge clk) begin
          old_state <= d;
        end

        assign q = old_state;
      endmodule
      """
    Then I should see a register node "old_state"
    When I update "top.sv" in the editor to:
      """sv
      module top(
        input logic clk,
        input logic d,
        output logic q
      );
        logic edited_state;

        always_ff @(posedge clk) begin
          edited_state <= d;
        end

        assign q = edited_state;
      endmodule
      """
    Then I should see a register node "edited_state"
    And I should not see a register node "old_state"
    When I run the CLI command:
      """
      svsch render top.sv --output top.svg --no-layout
      """
    Then the CLI output should contain "edited_state"
    And the CLI output should not contain "old_state"
