Feature: Partial diagram
  The ephemeral "Partial Diagram" pane (issue #403): selecting a node on the
  main diagram and clicking "Add to Partial [P]" opens (or reuses) a second
  "SVSCH Partial Diagram" webview holding a clone of that node with every
  wire cut. Hovering a cut net end reveals an "extend" arrow that pulls in
  the node on the other end of that net — resolved against the original
  module's edge list — and ties the net inside the partial only. Existing
  nodes stay locked in place when a new node is pulled in (locked-node ELK
  layout). Nothing is persisted: closing the pane discards all of its state.

  Scenario: Add to Partial opens a partial diagram with the node's wires cut
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a, output logic y);
        logic mid;
        leaf u1(.a(a), .y(mid));
        leaf u2(.a(mid), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    Then the "Add to Partial" button should be visible
    When I add the selected block to the partial diagram
    Then the SVSCH partial diagram panel opens
    When I switch to the partial diagram panel
    Then I should see an instance node "u1" of module "leaf"
    And I should see 1 cut net labels named "a"
    And I should see 1 cut net labels named "mid"
    And I should not see an instance node "u2"

  Scenario: Extending a cut net pulls in the far node and keeps existing nodes in place
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a, output logic y);
        logic mid;
        leaf u1(.a(a), .y(mid));
        leaf u2(.a(mid), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I add the selected block to the partial diagram
    Then the SVSCH partial diagram panel opens
    When I switch to the partial diagram panel
    Then the extend arrow should be visible on the cut net "mid"
    When I note the position of the block "u1"
    And I click the extend arrow on the cut net "mid"
    Then I should see an instance node "u2" of module "leaf"
    And there should be a connection between "u1" and "u2"
    And I should not see cut net labels named "mid"
    And the block "u1" should not have moved

  Scenario: A second Add to Partial reuses the already-open pane
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a, output logic y);
        logic mid;
        leaf u1(.a(a), .y(mid));
        leaf u2(.a(mid), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I add the selected block to the partial diagram
    Then the SVSCH partial diagram panel opens
    When I switch to the main diagram panel
    And I click to select the block "u2"
    And I add the selected block to the partial diagram
    Then there should be exactly one partial diagram panel
    When I switch to the partial diagram panel
    Then I should see an instance node "u1" of module "leaf"
    And I should see an instance node "u2" of module "leaf"
    And I should see 2 cut net labels named "mid"
    And there should not be a connection between "u1" and "u2"

  Scenario: Closing the partial panel discards its state
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a, output logic y);
        logic mid;
        leaf u1(.a(a), .y(mid));
        leaf u2(.a(mid), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I add the selected block to the partial diagram
    Then the SVSCH partial diagram panel opens
    When I switch to the partial diagram panel
    And I click the extend arrow on the cut net "mid"
    Then I should see an instance node "u2" of module "leaf"
    When I close the partial diagram panel
    And I click to select the block "u2"
    And I add the selected block to the partial diagram
    Then the SVSCH partial diagram panel opens
    When I switch to the partial diagram panel
    Then I should see an instance node "u2" of module "leaf"
    And I should not see an instance node "u1"
    And I should see 1 cut net labels named "mid"
