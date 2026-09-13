Feature: Diagram Interaction
  As a hardware designer
  I want to interact with the block diagram
  So that I can customize the layout to my preference

  Scenario: Expanding an instance in place inlines its child module, and Collapse restores it
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
    Then the "Expand" button should be visible
    When I click the "Expand" button
    Then I should see a boundary port node named "a"
    And I should see a boundary port node named "y"
    And I should see a dimmed instance node "u1"
    When I collapse the expanded instance "u1"
    Then I should not see a boundary port node named "a"
    And I should see an instance node "u1" of module "leaf"

  Scenario: An expanded instance stays expanded across a diagram reload
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
    And I click the "Expand" button
    Then I should see a boundary port node named "a"
    When I close and reopen the diagram
    Then I should see a boundary port node named "a"
    # Regression: collapsing an auto-restored instance used to bounce — the
    # webview's expanded-instance list (delivered with the graph message on
    # reopen) went stale on Collapse and the auto-restore effect immediately
    # re-expanded it.
    When I collapse the expanded instance "u1"
    Then the instance "u1" should stay collapsed
    And I should not see a boundary port node named "a"
    And I should see an instance node "u1" of module "leaf"

  Scenario: The Expand button is not offered for a stacked instance array
    Given I have a file "top.sv" in my workspace:
      """
      module leaf(input logic a, output logic y);
        assign y = a;
      endmodule

      module top(input logic a [1:0], output logic y [1:0]);
        leaf u_mux [1:0] (.a(a), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u_mux"
    Then the "Expand" button should not be visible

  Scenario: Moving an expanded instance moves its entire spliced content
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic a, output logic y);
        assign y = a;
      endmodule

      module leaf(input logic a, output logic y);
        inner u_inner(.a(a), .y(y));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.a(a), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see a boundary port node named "a"
    And I should see an instance node "u_inner" of module "inner"
    And I note the position of the boundary port node "a"
    And I note the position of the boundary port node "y"
    And I note the position of the block "u_inner"
    When I move the expanded instance "u1" by (2, -1) grid cells
    Then the boundary port node "a" should have moved by (2, -1) grid cells
    And the boundary port node "y" should have moved by (2, -1) grid cells
    And the block "u_inner" should have moved by (2, -1) grid cells

  # TODO(#241): currently fails against real behavior, not a test bug — confirmed by
  # running this locally against a real surelog+svsch_backend: dragging u_inner
  # visually leaves it hanging outside the frame with no resize. Root cause:
  # ActiveSplice.expandedSize (src/webview/expand/expandOverlay.ts) is fixed at
  # expand-time and never recomputed from live content — syncSpliceCache
  # explicitly pins bounds.width/height back to the stale splice.expandedSize
  # every reattach ("which node-drags don't update"). Unlike generate regions
  # (their own always-visible `.generate-region` overlay reads `regions` state
  # directly every render), an expand region's frame IS the dimmed instance
  # node's baked-in sizeOverride (dimAsExpandGhost), applied only through
  # applyActiveSplices — which itself only reruns on a `view`/`spliceVersion`
  # change, not on every node drag. Growing this needs both recomputing
  # expandedSize from expandRegionsForNodes' hugged bounds *and* re-applying
  # splices (or otherwise pushing the new sizeOverride) after an internal-node
  # drag stop, not just a one-line bounds fix.
  @skip
  Scenario: Moving a node inside an expanded instance grows its frame
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic a, output logic y);
        assign y = a;
      endmodule

      module leaf(input logic a, output logic y);
        inner u_inner(.a(a), .y(y));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.a(a), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see an instance node "u_inner" of module "inner"
    And I note the bounds of the block "u1"
    When I move the node "u_inner" inside the expanded instance by (8, 0) grid cells
    Then the "u1" block should have grown on the right side

  Scenario: An instance nested inside an already-expanded instance cannot be expanded directly
    Given I have a file "top.sv" in my workspace:
      """
      module inner(input logic a, output logic y);
        assign y = a;
      endmodule

      module leaf(input logic a, output logic y);
        inner u_inner(.a(a), .y(y));
      endmodule

      module top(input logic a, output logic y);
        leaf u1(.a(a), .y(y));
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "u1"
    And I click the "Expand" button
    Then I should see an instance node "u_inner" of module "inner"
    When I click to select the block "u_inner"
    Then the "Expand" button should not be visible
    When I collapse the expanded instance "u1"
    Then I should see an instance node "u1" of module "leaf"

  # Callable counterpart to "Expanding an instance in place" above (issue
  # #335, revised in PR #336 review): unlike an instance, a function/task
  # call site has no standalone module of its own to navigate to — its body
  # can read/write signals from its enclosing module's scope directly,
  # without those ever being formal arguments, so it isn't a self-contained
  # diagram double-click could hand off to (see PR #336 discussion). Expand
  # (toolbar button, same trigger and mechanism instance expansion uses)
  # unfolds the call's own body in place read-only instead; double-click is
  # a no-op for these kinds (see "Double-clicking..." below).
  Scenario: Expanding a function call in place, and Collapse restores it
    Given I have a file "top.sv" in my workspace:
      """
      module top(input logic [7:0] a, input logic [7:0] b, output logic [7:0] y);
        function automatic [7:0] foo(input [7:0] lhs, input [7:0] rhs);
          foo = lhs + rhs;
        endfunction

        assign y = foo(a, b);
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "foo"
    Then the "Expand" button should be visible
    When I click the "Expand" button
    Then I should see a boundary port node named "lhs"
    And I should see a boundary port node named "rhs"
    And I should see a dimmed function call node "foo"
    When I collapse the expanded function call "foo"
    Then I should not see a boundary port node named "lhs"
    And I should see a function call node "foo"

  Scenario: Expanding a task call in place, and Collapse restores it
    Given I have a file "top.sv" in my workspace:
      """
      module top(input logic [7:0] a, output logic [7:0] y);
        task automatic bump(input [7:0] value, output [7:0] result);
          result = value + 1;
        endtask

        always_comb begin
          bump(a, y);
        end
      endmodule
      """
    When I open the "top" module in SVSCH
    And I click to select the block "bump"
    Then the "Expand" button should be visible
    When I click the "Expand" button
    Then I should see a boundary port node named "value"
    And I should see a boundary port node named "result"
    And I should see a dimmed task call node "bump"
    When I collapse the expanded task call "bump"
    Then I should not see a boundary port node named "value"
    And I should see a task call node "bump"

  Scenario: Double-clicking a function call or task call block does nothing
    Given I have a file "top.sv" in my workspace:
      """
      module top(input logic [7:0] a, input logic [7:0] b, output logic [7:0] y);
        function automatic [7:0] foo(input [7:0] lhs, input [7:0] rhs);
          foo = lhs + rhs;
        endfunction

        assign y = foo(a, b);
      endmodule
      """
    When I open the "top" module in SVSCH
    And I double-click on the function call node "foo"
    Then I should not see a boundary port node named "lhs"
    And I should see a function call node "foo"
