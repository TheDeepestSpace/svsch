Feature: Sub-diagram interaction
  Interacting with the sub-diagram spliced inside an expanded instance
  ("Expand instance in place", issue #232). Mirrors the applicable basics of
  diagram_interaction.feature in the sub-diagram context: node movement, wire
  reshaping and the containment invariant (nothing inside the expanded module
  may escape its border), plus how top-level drag-selection and Auto Layout
  behave while an instance is expanded. Scenarios that depend on behavior
  tracked by follow-up issues are stubbed here with @skip and a reference.

  Scenario: Moving a node inside the sub-diagram moves it and every wire stays inside the frame
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        inner u_inner(.w(la), .z(ly));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see an instance node "u_inner" of module "inner"
    When I note the position of the block "u_inner"
    And I move the node "u_inner" inside the expanded instance by (2, 1) grid cells
    Then the block "u_inner" should have moved by (2, 1) grid cells
    And all spliced content should stay inside the expanded instance "u1"

  Scenario: A moved sub-diagram node keeps its position across a diagram reload
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        inner u_inner(.w(la), .z(ly));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see an instance node "u_inner" of module "inner"
    When I move the node "u_inner" inside the expanded instance by (2, 1) grid cells
    And I note the position of the block "u_inner"
    And I close and reopen the diagram
    Then I should see a boundary port node named "la"
    And the block "u_inner" should not have moved

  Scenario: Dragging a wire inside the sub-diagram reroutes it but it never escapes the frame
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        inner u_inner(.w(la), .z(ly));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see an instance node "u_inner" of module "inner"
    When I drag a wire segment between "la" and "u_inner" inside the expanded instance down by 6 grid cells
    Then all spliced content should stay inside the expanded instance "u1"

  # The child spans several internal nodes so its unfolded diagram has real
  # whitespace between them — the canvas the pointer is supposed to fall
  # through to. A single-node child leaves (almost) no exposed interior: the
  # frame is grown to hug its content plus the border ring.
  Scenario: The sub-diagram area is pannable canvas, not a grab-area of the expanded instance
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic clk, input logic la, output logic ly);
        logic s1, s2;
        always_ff @(posedge clk) s1 <= la;
        always_ff @(posedge clk) s2 <= s1;
        assign ly = s2;
      endmodule

      module top(input logic clk, input logic a, output logic y);
        leaf u1(.clk(clk), .la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see a boundary port node named "la"
    When I note the position of the block "u1"
    And I note the position of the block "s1"
    And I middle-drag inside the sub-diagram area of the expanded instance "u1"
    Then the canvas should have panned
    And the block "u1" should not have moved
    And the block "s1" should not have moved
    When I left-drag inside the sub-diagram area of the expanded instance "u1"
    Then the block "u1" should not have moved
    And the block "s1" should not have moved

  Scenario: Drag-selection crossing the expanded instance selects only top-level nodes
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        inner u_inner(.w(la), .z(ly));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see a boundary port node named "la"
    When I drag-select across the entire diagram
    Then no sub-diagram nodes should be selected
    And the block "u1" should remain selected

  Scenario: Auto Layout on a border-crossing drag-selection re-lays out the outer diagram and carries the sub-diagram along
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        inner u_inner(.w(la), .z(ly));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see a boundary port node named "la"
    When I drag-select across the entire diagram
    Then no sub-diagram nodes should be selected
    And the "Auto Layout" button should be visible
    When I click the "Auto Layout" button
    Then the block "u1" should be re-placed and fixed in the saved layout
    And I should see a boundary port node named "la"
    And all spliced content should stay inside the expanded instance "u1"
    And the saved layout should contain no sub-diagram entries

  # TODO(#242): a drag that stays fully inside the expanded node's borders
  # should be a *local* selection — selecting only sub-diagram nodes, so
  # operations like Auto Layout apply within the sub-diagram without touching
  # the outer diagram. No such border-containment logic exists yet (marquee
  # selection is top-level-only for now); this stub locks the intended
  # semantics in place for when #242 lands.
  @skip
  Scenario: A drag fully inside the expanded instance locally selects its sub-diagram nodes
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        inner u_inner(.w(la), .z(ly));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see an instance node "u_inner" of module "inner"

  # TODO(#241): reshaped sub-diagram wire routes currently live only in the
  # webview's splice cache — they survive splice reattachments within a
  # session but are not part of SavedExpandedInstanceLayout, so a reload
  # resets them to the default route. Lock persistence in here once #241
  # adds them to the per-instance snapshot.
  @skip
  Scenario: A reshaped sub-diagram wire keeps its route across a diagram reload
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        inner u_inner(.w(la), .z(ly));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see an instance node "u_inner" of module "inner"
