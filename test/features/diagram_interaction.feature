Feature: Diagram Interaction
  As a hardware designer
  I want to interact with the block diagram
  So that I can customize the layout to my preference

  Scenario: Moving a single block
    Given a SystemVerilog module:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I move the port node "a" by (100, 100)
    Then the port node "a" should have moved

  Scenario: Manual positions are preserved across diagram reloads
    Given a SystemVerilog module:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I move the port node "a" to (120, 132)
    And I close and reopen the diagram
    Then the port node "a" should be at (120, 132)

  Scenario: Manual positions are remembered even if the node is temporarily removed
    Given a SystemVerilog module:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I move the port node "a" to (120, 132)
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
    Then the port node "a" should be at (120, 132)

  Scenario: Resetting the layout
    Given a SystemVerilog module:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    And I note the position of port node "a"
    When I move the port node "a" to (120, 120)
    And I reset the layout
    Then the port node "a" should not have moved

  Scenario: Rerouting a single connection without affecting other routes or positions
    Given a SystemVerilog module:
      """
      module top(input a, input b, output x, output y);
        assign x = b;
        assign y = a;
      endmodule
      """
    When I move the port node "a" to (120, 132)
    And I move the port node "y" to (480, 252)
    And I force the connection between "a" and "y" to pass through (240, 468)
    And I force the connection between "b" and "x" to pass through (240, 100)
    And I note the route of the connection between "a" and "y"
    And I note the route of the connection between "b" and "x"
    And I note the position of port node "a"
    And I note the position of port node "y"
    And I hover the connection between "a" and "y" and click its Reroute control
    Then the route of the connection between "a" and "y" should have changed
    And the route of the connection between "b" and "x" should not have changed
    And the port node "a" should not have moved
    And the port node "y" should not have moved

  Scenario: Rerouting without moving blocks
    Given a SystemVerilog module:
      """
      module top(input a, input b, output x, output y);
        assign x = b;
        assign y = a;
      endmodule
      """
    When I move the port node "a" to (120, 132)
    And I move the port node "y" to (480, 252)
    And I force the connection between "a" and "y" to pass through (240, 468)
    And I note the position of port node "a"
    And I note the position of port node "b"
    And I note the position of port node "x"
    And I note the position of port node "y"
    And I note the route of the connection between "a" and "y"
    And I reroute the diagram
    Then the port node "a" should not have moved
    And the port node "b" should not have moved
    And the port node "x" should not have moved
    And the port node "y" should not have moved
    And the route of the connection between "a" and "y" should have changed

  Scenario: Cutting, renaming, and tying back a fanout net
    Given a SystemVerilog module:
      """
      module top(input a, output x, output y);
        assign x = a;
        assign y = a;
      endmodule
      """
    And I position the port node "a" at (24, -36)
    Then the port node "a" should be at (24, -36)
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
    Given a SystemVerilog module:
      """
      module top(input a, input b, output x, output y);
        assign x = a;
        assign y = b;
      endmodule
      """
    And I note the position of port node "a"
    And I note the position of port node "b"
    When I drag port nodes "a" and "b" together
    And I close and reopen the diagram
    Then the port node "a" should have moved
    And the port node "b" should have moved

  # TODO: to fix - snapshot mismatch and hint visibility after 12px centering update
  @skip
  Scenario: Resolving overlap hints manually
    Given a SystemVerilog module:
      """
      module top(input a, input b, output x, output y);
        assign x = a;
        assign y = b;
      endmodule
      """
    And I move the port node "b" by (0, -48)
    And I move the port node "y" by (0, -48)
    Then I should see overlap hints
    When I move the port node "b" by (0, 48)
    And I move the port node "y" by (0, 48)
    Then I should not see any overlap hints
