Feature: Partial diagram
  As a hardware design engineer
  I want to be able to observe and traverse a subset of the diagram nodes
  So that I can more easily comprehend complex hierarchies by looking at their controlled, reduced subset

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

  Scenario: Selecting multiple blocks and clicking Add to Partial adds them all at once
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
    And I add the block "u2" to the selection
    Then the "Add to Partial" button should be visible
    When I add the selected block to the partial diagram
    Then the SVSCH partial diagram panel opens
    When I switch to the partial diagram panel
    Then I should see an instance node "u1" of module "leaf"
    And I should see an instance node "u2" of module "leaf"
    And I should see 1 cut net labels named "a"
    And I should see 2 cut net labels named "mid"
    And I should see 1 cut net labels named "u2.y"
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

  Scenario: Extending a fanout wire in the partial diagram reveals every node it feeds
    Given I have a file "top.sv" in my workspace:
      """
      module top(
        input logic sel_a,
        input logic sel_b,
        input logic dflt,
        output logic out_a,
        output logic out_b
      );
        always_comb begin
          case (sel_a)
            1'b1: out_a = 1'b1;
            default: out_a = dflt;
          endcase
        end
        always_comb begin
          case (sel_b)
            1'b1: out_b = 1'b1;
            default: out_b = dflt;
          endcase
        end
      endmodule
      """
    When I open the "top" module in SVSCH
    Then I should see a mux node "case sel_a"
    And I should see a mux node "case sel_b"
    And there should be a connection between "dflt" and the mux node "case sel_a"
    And there should be a connection between "dflt" and the mux node "case sel_b"
    When I click to select the block "case sel_a"
    And I add the selected block to the partial diagram
    Then the SVSCH partial diagram panel opens
    When I switch to the partial diagram panel
    Then I should see a mux node "case sel_a"
    And I should not see a mux node "case sel_b"
    And I should see 1 cut net labels named "dflt"
    When I click the extend arrow on the cut net "dflt"
    Then I should see a port node "dflt"
    And there should be a connection between "dflt" and the mux node "case sel_a"
    # "dflt" still feeds "case sel_b" too — tying the branch that was just
    # extended must not silently drop the other one; a fresh cut end for it
    # stays on "dflt" until that branch is extended on its own.
    And I should not see a mux node "case sel_b"
    And I should see 1 cut net labels named "dflt"
    When I click the extend arrow on the cut net "dflt"
    Then I should see a mux node "case sel_b"
    And there should be a connection between "dflt" and the mux node "case sel_a"
    And there should be a connection between "dflt" and the mux node "case sel_b"
    # Every branch of the fanout is now tied — no cut end is left on "dflt".
    # The muxes' own other nets (selects, outputs, literal feeds) stay cut:
    # extending one net never silently pulls in the rest of the module.
    And I should not see cut net labels named "dflt"
