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
