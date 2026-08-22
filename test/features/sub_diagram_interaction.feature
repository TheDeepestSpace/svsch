Feature: Sub-diagram interaction
  Interacting with the sub-diagram spliced inside an expanded instance
  ("Expand instance in place", issue #232). The spliced content is read-only:
  its layout — node positions and wire routes — always comes from the child
  module's own standalone view, the only place it can be edited, and the
  expanded frame's size always follows that layout as-is (never a manual
  override). This mirrors the applicable basics of diagram_interaction.feature
  in the sub-diagram context: the containment invariant (nothing inside the
  expanded module may escape its border), plus how top-level drag-selection
  and Auto Layout behave while an instance is expanded. Scenarios that depend
  on behavior tracked by follow-up issues are stubbed here with @skip and a
  reference.

  Scenario: A node inside the sub-diagram cannot be moved
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
    And I try to drag the node "u_inner" inside the expanded instance by (2, 1) grid cells
    Then the block "u_inner" should not have moved
    And all spliced content should stay inside the expanded instance "u1"

  Scenario: A wire inside the sub-diagram cannot be rerouted
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
    When I try to drag a wire segment between "la" and "u_inner" inside the expanded instance down by 6 grid cells
    Then the wire between "la" and "u_inner" inside the expanded instance should not have rerouted
    And all spliced content should stay inside the expanded instance "u1"

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

  # Locks in the ELK size handoff: the host's Auto Layout pass must place the
  # released blocks against the expanded instance's *frame* footprint (posted
  # as transient expandedSizes with relayoutSelection), not the collapsed
  # canonical size — otherwise re-placed siblings land underneath the frame.
  Scenario: Auto Layout places outer blocks clear of the expanded frame
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        logic t1;
        inner u_a(.w(la), .z(t1));
        inner u_b(.w(t1), .z(ly));
      endmodule

      module top(input logic a, input logic b, output logic y, output logic z);
        leaf u1(.la(a), .ly(y));
        leaf u2(.la(b), .ly(z));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see a boundary port node named "la"
    When I fit the diagram in view
    And I drag-select across the entire diagram
    Then the "Auto Layout" button should be visible
    When I click the "Auto Layout" button
    Then the block "u1" should be re-placed and fixed in the saved layout
    And no top-level block should overlap the expanded instance "u1"
    And all spliced content should stay inside the expanded instance "u1"

  # A cut net's dangling end is re-derived from its owning port's lead point —
  # once the instance expands, that port sits on the *frame* border, well past
  # the collapsed box the host's geometry pass would otherwise use. Auto Layout
  # must release the label together with its (expanded) instance and re-anchor
  # it against the frame, not leave it at the collapsed-size position inside
  # the frame.
  Scenario: Auto Layout re-anchors a cut net end to the expanded frame's border
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        logic t1;
        inner u_a(.w(la), .z(t1));
        inner u_b(.w(t1), .z(ly));
      endmodule

      module top(input logic a, input logic b, output logic y, output logic z);
        leaf u1(.la(a), .ly(y));
        leaf u2(.la(b), .ly(z));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I hover the connection between "u1" and "y" and click its Cut control
    And I note the position of the cut net label attached to "u1"
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see a boundary port node named "la"
    When I fit the diagram in view
    And I drag-select across the entire diagram
    Then the "Auto Layout" button should be visible
    When I click the "Auto Layout" button
    Then the block "u1" should be re-placed and fixed in the saved layout
    And the cut net label attached to "u1" should have moved
    And no top-level block should overlap the expanded instance "u1"
    And all spliced content should stay inside the expanded instance "u1"

  # The expanded frame's size always comes from the child module's own
  # current layout (see splice.ts's expandedFrameSize) — there is no manual
  # resize affordance on it at all (see NodeResizeControls's call site in
  # HdlNode.tsx, which skips rendering resize handles for an expand ghost).
  Scenario: The expanded frame cannot be manually resized
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
    And the expanded instance "u1" should show its inner content border
    When I note the bounds of the block "u1"
    And I try to resize the expanded instance "u1" on the right side by 4 grid cells
    Then the block "u1" should have kept its noted size

  # Boundary port nodes stay glued to the frame border — user-dragging them
  # is the movable-port-labels follow-up (#218), disabled until that lands.
  Scenario: Boundary port nodes on the expanded frame are not movable yet
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
    When I note the position of the boundary port node "la"
    And I try to drag the boundary port node "la" by (3, 2) grid cells
    Then the boundary port node "la" should not have moved

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

  # Locks in the product decision: only a child module's own standalone view
  # can edit its layout, and every expanded instance of it must reflect
  # whatever that layout currently is — growing or shrinking the frame to
  # fit — the next time the diagram containing the expanded instance is shown
  # (this app has a single diagram panel; "shown again" is exactly navigating
  # back to it via the module dropdown/double-click, or a reload). Growing
  # and shrinking are both exercised here by moving the same node out and
  # back. Needs two internal nodes wired to each other (not just port-to-port
  # through a single node): with only one node whose edges both touch the
  # module's own ports, the frame's content-relative translation and size are
  # translation-invariant in that node's own position, so moving it changes
  # nothing observable — see u_a/u_b's internal net "t1" below.
  Scenario: An expanded instance's sub-diagram and frame follow the child module's own layout
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic w, output logic z);
        assign z = w;
      endmodule

      module leaf(input logic la, output logic ly);
        logic t1;
        inner u_a(.w(la), .z(t1));
        inner u_b(.w(t1), .z(ly));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.la(a), .ly(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see an instance node "u_a" of module "inner"
    When I note the position of the block "u_b"
    And I note the bounds of the block "u1"
    # Edit the child module's own layout directly — the only place it can be
    # edited (see the header comment) — then navigate back to "top" the same
    # way a user would (the module dropdown, mirroring double-clicking the
    # instance to open its module and back).
    And I select module "leaf" from the dropdown
    And I move the block "u_b" by (10, 6) grid cells
    And I select module "top" from the dropdown
    Then the block "u_b" should have moved
    And the block "u1" should have grown to fit its new content
    When I note the bounds of the block "u1"
    And I select module "leaf" from the dropdown
    And I move the block "u_b" by (-10, -6) grid cells
    And I select module "top" from the dropdown
    Then the block "u1" should have shrunk to fit its new content
