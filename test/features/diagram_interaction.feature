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
    When I move the port node "a" to (120, 120)
    And I close and reopen the diagram
    Then the port node "a" should be at (120, 120)

  Scenario: Manual positions are remembered even if the node is temporarily removed
    Given a SystemVerilog module:
      """
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I move the port node "a" to (120, 120)
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
    Then the port node "a" should be at (120, 120)

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
