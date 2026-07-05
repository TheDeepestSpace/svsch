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

  Scenario: Moving the block within an arm expands its boundary appropriately
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top #(parameter MODE = 1) (
        input logic a,
        input logic b,
        output logic y
      );
        generate
          if (MODE == 1) begin : g_if_one
            leaf u_if_one(.a(a), .y(y));
          end else begin : g_if_other
            leaf u_other(.a(b), .y(y));
          end
        endgenerate
      endmodule
      """
    When I open the "top" module in SVSCH
    And I begin moving the block "g_if_one.u_if_one" in the "g_if_one" generate region by (8, 0) grid cells
    Then the "g_if_one" generate region should have expanded on the right side while dragging
    When I release the moving block
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
    And I note the route from "g_if_one.u_path_a" to the combinational block
    When I move the "g_if_one" generate region by (2, -1) grid cells
    Then all blocks in the "g_if_one" generate region should have moved by (2, -1) grid cells
    And blocks outside the "g_if_one" generate region should not have moved
    And the route from "g_if_one.u_path_a" to the combinational block should have shifted by (2, -1) grid cells

  Scenario: Moving a generate block moves every arm and block inside it
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
    Then the diagram should contain a "generate if" generate block
    When I move the "generate if" generate region by (2, -1) grid cells
    Then all blocks in the "generate if" generate region should have moved by (2, -1) grid cells

  Scenario: Warning when generate arm blocks overlap
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
    Then the diagram should contain exactly 3 generate regions
    And no generate region should be flagged as overlapping
    When I move the "g_if_one" generate region by (0, -3) grid cells
    Then the "g_if_zero" generate region should be flagged as overlapping
    And the "g_if_one" generate region should be flagged as overlapping
    And I should see a warning icon on the "g_if_zero" generate region
    And I should see a warning icon on the "g_if_one" generate region
    When I hover over the warning icon on the "g_if_one" generate region
    Then a tooltip should appear reading "arm blocks overlapping"
    When I move the "g_if_one" generate region by (0, 3) grid cells
    Then no generate region should be flagged as overlapping
    And I should not see any generate region warning icons

  Scenario: Warning when two generate blocks overlap
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top #(parameter MODE = 1) (
        input logic a,
        output logic z
      );
        logic w1;

        generate
          if (MODE == 1) begin : g_if_on
            leaf u_if(.a(a), .y(w1));
          end
        endgenerate

        // implicit generate: the generate/endgenerate keywords are optional
        case (MODE)
          default: begin : g_case_def
            leaf u_case_def(.a(w1), .y(z));
          end
        endcase
      endmodule
      """
    When I open the "top" module in SVSCH
    Then the diagram should contain a "generate if" generate block
    And the diagram should contain a "generate case (MODE)" generate block
    And no generate region should be flagged as overlapping
    When I move the "generate if" generate region by (8, 0) grid cells
    Then the "generate if" generate region should be flagged as overlapping
    And the "generate case (MODE)" generate region should be flagged as overlapping
    And I should see a warning icon on the "generate if" generate region
    And I should see a warning icon on the "generate case (MODE)" generate region
    When I hover over the warning icon on the "generate if" generate region
    Then a tooltip should appear reading "generate blocks overlapping"
    When I move the "generate if" generate region by (-8, 0) grid cells
    Then no generate region should be flagged as overlapping
    And I should not see any generate region warning icons

  Scenario: Warning when a block overlaps an unrelated generate arm
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top #(parameter MODE = 1) (
        input logic a,
        input logic b,
        output logic y,
        output logic z
      );
        logic w;

        leaf u_free(.a(a), .y(z));

        generate
          if (MODE == 1) begin : g_arm
            leaf u_arm(.a(b), .y(w));
          end
        endgenerate

        assign y = w;
      endmodule
      """
    When I open the "top" module in SVSCH
    Then no generate region should be flagged as overlapping
    And no block should be flagged as overlapping an arm
    When I move the "g_arm" generate region by (0, -3) grid cells
    Then the "g_arm" generate region should be flagged as containing an unrelated block
    And the "u_free" block should be flagged as overlapping an arm
    But the "g_arm.u_arm" block should not be flagged as overlapping an arm
    And I should see a warning icon on the "g_arm" generate region
    And I should see a warning icon on the "u_free" block
    When I hover over the warning icon on the "g_arm" generate region
    Then a tooltip should appear reading "node does not belong to arm block"
    When I hover over the warning icon on the "u_free" block
    Then a tooltip should appear reading "this block does not belong to a generate arm block"
    And the "generate if" generate block should be flagged as containing an unrelated block
    When I hover over the warning icon on the "generate if" generate region
    Then a tooltip should appear reading "block does not belong to this generate block"

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
