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

  Scenario: Declared nets are automatically cut on first open
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, output x, output y);
        wire chip_select;
        assign chip_select = a;
        assign x = chip_select;
        assign y = chip_select;
      endmodule
      """
    When I open the "top" module in SVSCH
    Then I should see 3 cut net labels named "chip_select"
    And the original connection between "a" and "x" should be hidden
    And the original connection between "a" and "y" should be hidden

  Scenario: Register clock and reset nets are automatically cut on first open
    Given I have a file "top.sv" in my workspace:
      """
      module top(input logic clk, input logic rst_n, input logic d, output logic q);
        always_ff @(posedge clk or negedge rst_n) begin
          if (!rst_n) q <= 1'b0;
          else q <= d;
        end
      endmodule
      """
    When I open the "top" module in SVSCH
    Then I should see 2 cut net labels named "clk"
    And I should see 2 cut net labels named "rst_n"

  Scenario: Register clock and reset automatic cuts can be disabled
    Given I disable clock and reset cuts using this setting:
      """
      "svsch.autocut-clk-reset": false
      """
    And I have a file "top.sv" in my workspace:
      """
      module top(input logic clk, input logic rst_n, input logic d, output logic q);
        always_ff @(posedge clk or negedge rst_n) begin
          if (!rst_n) q <= 1'b0;
          else q <= d;
        end
      endmodule
      """
    When I open the "top" module in SVSCH
    Then I should not see cut net labels named "clk"
    And I should not see cut net labels named "rst_n"

  Scenario: Resetting the layout reapplies both automatic cut heuristics
    Given I have a file "top.sv" in my workspace:
      """
      module top(
        input logic clk,
        input logic rst_n,
        input logic d,
        input logic a,
        output logic q,
        output logic x,
        output logic y
      );
        wire chip_select;
        assign chip_select = a;
        assign x = chip_select;
        assign y = chip_select;
        always_ff @(posedge clk or negedge rst_n) begin
          if (!rst_n) q <= 1'b0;
          else q <= d;
        end
      endmodule
      """
    When I open the "top" module in SVSCH
    And I tie back the cut net "chip_select"
    And I tie back the cut net "clk"
    And I tie back the cut net "rst_n"
    Then I should not see cut net labels named "chip_select"
    And I should not see cut net labels named "clk"
    And I should not see cut net labels named "rst_n"
    When I reset the layout
    Then I should see 3 cut net labels named "chip_select"
    And I should see 2 cut net labels named "clk"
    And I should see 2 cut net labels named "rst_n"

  Scenario: Cutting and tying back a fanout net whose source name is declared in the SV source
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, output x, output y);
        wire chip_select;
        assign chip_select = a;
        assign x = chip_select;
        assign y = chip_select;
      endmodule
      """
    When I open the "top" module in SVSCH
    # "chip_select" has a declared name, so it's auto-cut on first open; tie it
    # back first so the connection is actually there to manually cut below.
    And I tie back the cut net "chip_select"
    And I move the port node "a"
    When I hover the connection between "a" and "x" and click its Cut control
    Then I should see 3 cut net labels named "chip_select"
    And the original connection between "a" and "x" should be hidden
    And the original connection between "a" and "y" should be hidden
    # "chip_select" is an explicitly declared wire from the source, not a
    # tool-invented guess, so it renders in regular type and can't be edited
    # into a different name.
    And the cut net "chip_select" should be shown in regular type
    When I double-click the cut net "chip_select"
    Then the cut net "chip_select" should not become editable
    And I should see 3 cut net labels named "chip_select"
    When I tie back the cut net "chip_select"
    Then the original connection between "a" and "x" should be restored
    And the original connection between "a" and "y" should be restored
    And I should not see cut net labels named "chip_select"

  Scenario: Renaming a cut net that has no declared name of its own (implicit wiring)
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
    # "a" is only ever the port's own name here — there is no wire declared
    # for this net, so its cut label is a tool-invented guess and stays
    # freely renameable, unlike a net with a real wire declaration. Right
    # after the cut it's still the net's legitimate current name, though, so
    # it renders in regular type — only diverging from it earns italics.
    And the cut net "a" should be shown in regular type
    When I rename the cut net "a" to "chip_select"
    Then I should see 3 cut net labels named "chip_select"
    And the cut net "chip_select" should be shown in italics
    When I click the Revert label control on the cut net "chip_select"
    Then I should see 3 cut net labels named "a"
    And the cut net "a" should be shown in regular type

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
    And I tie back every cut net
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
    And I tie back every cut net
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
    And I tie back every cut net
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
    And I tie back every cut net
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

  Scenario: Drag-selecting a connection highlights the wire itself
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And click and drag the mouse to select "a" and "y" together
    Then the connection between "a" and "y" should be shown as selected

  Scenario: Hovering one wire in a multi-wire selection reveals every selected wire's controls
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, input b, output x, output y);
        assign x = a;
        assign y = b;
      endmodule
      """
    When I open the "top" module in SVSCH
    And click and drag the mouse to select "a" and "b" together
    And I hover the connection between "a" and "x"
    Then the connection between "a" and "x" should show its controls
    And the connection between "b" and "y" should show its controls

  Scenario: Rerouting one wire in a multi-wire selection reroutes every selected wire
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, input b, output x, output y);
        assign x = a;
        assign y = b;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I move the port node "b"
    And I adjust the connection between "a" and "x" upward
    And I adjust the connection between "b" and "y" downward
    And click and drag the mouse to select "a" and "b" together
    And I hover the connection between "a" and "x" and click its Reroute control
    Then the route of the connection between "a" and "x" should have changed
    And the route of the connection between "b" and "y" should have changed
    And the port node "a" should not have moved
    And the port node "b" should not have moved

  Scenario: Cutting one wire in a multi-wire selection cuts every selected wire
    Given I have a file "top.sv" in my workspace:
      """
      module top(input a, input b, output x, output y);
        assign x = a;
        assign y = b;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I note the position of port node "x"
    And I note the position of port node "y"
    And click and drag the mouse to select "a" and "b" together
    And I hover the connection between "a" and "x" and click its Cut control
    Then I should see 2 cut net labels named "a"
    And I should see 2 cut net labels named "b"
    And the original connection between "a" and "x" should be hidden
    And the original connection between "b" and "y" should be hidden
    And the port node "a" should not have moved
    And the port node "b" should not have moved
    And the port node "x" should not have moved
    And the port node "y" should not have moved

  Scenario: The Auto Layout control only appears once multiple blocks are selected
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a, input logic b, output logic x, output logic y);
        leaf u1(.a(a), .y(x));
        leaf u2(.a(b), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    Then the "Auto Layout" button should not be visible
    When click and drag the mouse to select the blocks "u1" and "u2"
    Then the "Auto Layout" button should be visible

  Scenario: Cutting out a single selected block cuts every wire connected to it
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, input logic b, output logic y);
        assign y = a & b;
      endmodule

      module top(input logic a, input logic b, output logic y);
        leaf u1(.a(a), .b(b), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    Then the "Auto Layout" button should not be visible
    When I click the "Cut out" button
    Then I should see 2 cut net labels named "a"
    And I should see 2 cut net labels named "b"
    And I should see 2 cut net labels named "u1.y"
    And the original connection between "a" and "u1" should be hidden
    And the original connection between "b" and "u1" should be hidden
    And the original connection between "u1" and "y" should be hidden

  Scenario: Cutting out one block in a multi-block selection cuts every selected block's wires
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a, input logic b, input logic c, output logic x, output logic y, output logic z);
        leaf u1(.a(a), .y(x));
        leaf u2(.a(b), .y(y));
        leaf u3(.a(c), .y(z));
      endmodule
      """
    When I open the "top" module in SVSCH
    And click and drag the mouse to select the blocks "u1" and "u2"
    And I click the "Cut out" button
    Then I should see 2 cut net labels named "a"
    And I should see 2 cut net labels named "u1.y"
    And I should see 2 cut net labels named "b"
    And I should see 2 cut net labels named "u2.y"
    And the original connection between "a" and "u1" should be hidden
    And the original connection between "u1" and "x" should be hidden
    And the original connection between "b" and "u2" should be hidden
    And the original connection between "u2" and "y" should be hidden
    And I should not see cut net labels named "c"
    And the original connection between "c" and "u3" should be restored

  Scenario: The Cut out button is hidden for a block that's already fully cut out
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.a(a), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Cut out" button
    And I click to select the block "u1"
    Then the "Cut out" button should not be visible

  Scenario: Auto-laying out one connection's blocks anchors the result, leaves the other connection untouched, and carries cut net ends along
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a, input logic b, output logic x, output logic y);
        leaf u1(.a(a), .y(x));
        leaf u2(.a(b), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I hover the connection between "u1" and "x" and click its Cut control
    And I hover the connection between "b" and "u2" and click its Cut control
    And I move the port node "a"
    And I move the block "u1" by (2, 0) grid cells
    And I note the position of the block "u1"
    # u1's dangling end is not part of the upcoming selection at all — this is
    # the baseline for proving it's left alone.
    And I note the position of the cut net label attached to "u1"
    And I move the port node "b" by (0, 72)
    And I move the block "u2" by (3, 5) grid cells
    # Note u2's dangling end before the upcoming lasso. It sits above the
    # rectangle spanning b/u2/y, so it remains unselected but follows u2 when
    # the selected nodes are laid out.
    And I note the position of the cut net label attached to "u2"
    And I move the port node "y" by (0, 72)
    And click and drag the mouse to select "b", "u2", and "y" together
    Then the cut net label attached to "u2" should not be highlighted
    When I click the "Auto Layout" button
    Then the block "u2" should be re-placed and fixed in the saved layout
    And the block "u2" should stay near its pre-auto-layout position
    And the block "u2" should remain selected
    And the block "u1" should not have moved
    And the port node "a" should still be fixed in the saved layout
    And the cut net label attached to "u2" should have moved
    And the cut net label attached to "u2" should not overlap the block "u1"
    And the cut net label attached to "u1" should not have moved

  Scenario: Rerouting a cut net's dangling end resets it to its canonical position
    Given I have a file "top.sv" in my workspace:
      """
      module top(input logic x, output logic y);
        assign y = x;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "y" by (0, 96)
    And I hover the connection between "x" and "y" and click its Cut control
    And I note the position of the cut net label attached to "x"
    And I move the cut net label attached to "x" by (-3, -3) grid cells
    And I hover the cut net label attached to "x"
    And I click the Reroute control on the cut net label attached to "x"
    Then the cut net label attached to "x" should be at its noted position

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
