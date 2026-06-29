Feature: Diagram Interaction
  As a hardware designer
  I want to interact with the block diagram
  So that I can customize the layout to my preference

  Scenario: Moving a single block
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    Then the port node "a" should have moved

  Scenario: Manual positions are preserved across diagram reloads
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I close and reopen the diagram
    Then the port node "a" should be where I moved it to

  Scenario: Manual positions are remembered even if the node is temporarily removed
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    And I open the "top" module in SVSCH
    And I move the port node "a"

    When I open "top.sv"
    And I update the code to remove node "a":
      """
      module top(output y);
        assign y = 1'b0;
      endmodule
      """
    And I update the code to bring back node "a":
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    And I go back to the SVSCH diagram pane
    Then the port node "a" should be where I moved it to

  Scenario: Resetting the layout
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I reset the layout
    Then the port node "a" should be at its original position

  Scenario: Rerouting a single connection without affecting other routes or positions
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, input b, output x, output y);
        assign x = b;
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I move the port node "y"
    And I adjust the connection between "a" and "y" upward
    And I adjust the connection between "b" and "x" downward
    And I hover the connection between "a" and "y" and click its Reroute control
    Then the route of the connection between "a" and "y" should have changed
    And the route of the connection between "b" and "x" should not have changed
    And the port node "a" should not have moved
    And the port node "y" should not have moved

  Scenario: Rerouting without moving blocks
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, input b, output x, output y);
        assign x = b;
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I move the port node "y"
    And I adjust the connection between "a" and "y"
    And I click "Reroute All" in the diagram toolbar
    Then the port node "a" should not have moved
    And the port node "b" should not have moved
    And the port node "x" should not have moved
    And the port node "y" should not have moved
    And the route of the connection between "a" and "y" should have changed

  Scenario: Cutting, renaming, and tying back a fanout net
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, output x, output y);
        assign x = a;
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    When I hover the connection between "a" and "x" and click its Cut control
    Then I should see 3 cut net labels named "a"
    And the original connection between "a" and "x" should be hidden
    And the original connection between "a" and "y" should be hidden
    When I rename the cut net "a" to "data_a"
    Then I should see 3 cut net labels named "data_a"
    When I tie back the cut net "data_a"
    Then the original connection between "a" and "x" should be restored
    And the original connection between "a" and "y" should be restored
    And I should not see cut net labels named "data_a"

  Scenario: Moving multiple blocks as a group preserves all positions on reload
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, input b, output x, output y);
        assign x = a;
        assign y = b;
      endmodule
      """
    When I open the "top" module in SVSCH
    And click and drag the mouse to select "a" and "b" together
    And I move the selected nodes
    And I close and reopen the diagram
    Then the port node "a" should have moved
    And the port node "b" should have moved

  Scenario: Resizing an if/else generate arm clamps to inner content padding
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top #(parameter MODE = 1) (
        input logic a,
        input logic b,
        input logic c,
        output logic y
      );
        logic w;

        generate
          if (MODE == 0) begin : g_if_zero
            leaf u_if_zero(.a(a), .y(w));
          end else if (MODE == 1) begin : g_if_one
            leaf u_if_one(.a(b), .y(w));
          end else begin : g_if_other
            assign w = c;
          end
        endgenerate

        assign y = w;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I resize the "g_if_one" generate region on the right side by 3 grid cells
    Then the "g_if_one" generate region should have grown on the right side
    When I resize the "g_if_one" generate region on the right side by -30 grid cells
    Then the "g_if_one" generate region should keep 2 grid cells of padding on the right side

  Scenario: Moving a generate arm moves all blocks inside it
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top #(parameter MODE = 1) (
        input logic a,
        input logic b,
        input logic c,
        input logic sel,
        output logic y
      );
        generate
          if (MODE == 1) begin : g_if_one
            logic left_tap;
            logic right_tap;

            leaf u_path_a(.a(a), .y(left_tap));
            leaf u_path_b(.a(b), .y(right_tap));
            assign y = sel ? left_tap : right_tap;
          end else begin : g_if_other
            leaf u_other(.a(c), .y(y));
          end
        endgenerate
      endmodule
      """
    When I open the "top" module in SVSCH
    Then the "g_if_one" generate region should contain at least 3 blocks
    And there should be a connection between "g_if_one.u_path_a" and the combinational block in the "g_if_one" generate region
    And there should be a connection between "g_if_one.u_path_b" and the combinational block in the "g_if_one" generate region
    And there should be a connection between "sel" and the combinational block in the "g_if_one" generate region
    And there should be a connection between the combinational block in the "g_if_one" generate region and "y"
    When I move the "g_if_one" generate region by (2, -1) grid cells
    Then all blocks in the "g_if_one" generate region should have moved by (2, -1) grid cells
    And blocks outside the "g_if_one" generate region should not have moved

  # TODO: to fix - snapshot mismatch and hint visibility after 12px centering update
  @skip
  Scenario: Resolving overlap hints manually
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, input b, output x, output y);
        assign x = a;
        assign y = b;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "b" by (0, -48)
    And I move the port node "y" by (0, -48)
    Then I should see overlap hints
    When I move the port node "b" by (0, 48)
    And I move the port node "y" by (0, 48)
    Then I should not see any overlap hints
