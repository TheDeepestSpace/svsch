@cli
Feature: Command Line Interface

  Scenario: Help command output
    When I run the CLI command:
      """
      svsch --help
      """
    Then the CLI stdout should be exactly:
      """
      SVSCH CLI

      Usage:
        svsch render <file.sv> [--output <file.svg>] [--top <module>] [--layout <json>] [--no-layout]
        svsch render "<glob>" --output-dir <dir>

      Options:
        -o, --output <file>       Write a single SVG to this path
            --output-dir <dir>    Write one SVG per input into this directory
            --top <module>        Render a specific module
            --layout <json>       Use an explicit saved layout file
            --no-layout           Ignore saved layout and run auto-layout
            --theme <dark|light>  Fixed SVG color theme (default: dark)
            --workspace <dir>     Workspace root used for parser cache and relative paths
            --project-folder <d>  Project folder relative to workspace
            --svsch-data-dir <d>  Directory containing layouts/<module>.json (default: <workspace>/.svsch)
      """
    And the CLI stderr should be empty

  Scenario: Basic schematic rendering
    Given I have a file "top.sv" in my workspace:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I run the CLI command:
      """
      svsch render top.sv --output top.svg --no-layout
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      top.svg
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering top.svg without a layout file
      """
    And a file named "top.svg" should exist in the workspace
    And the CLI SVG should contain "port:top:a"
    And the CLI SVG should contain "port:top:y"

  Scenario: Render with manual layout
    Given I have a file "top.sv" in my workspace:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I run the CLI command:
      """
      svsch render top.sv --output top_with_layout.svg
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      top_with_layout.svg
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering top_with_layout.svg using layout file .svsch/layouts/top.json
      """
    And a file named "top_with_layout.svg" should exist in the workspace
    And the CLI SVG should contain "port:top:a"
    And the CLI SVG should have node "a" positioned as it is on the diagram

  Scenario: Render without manual layout (--no-layout)
    Given I have a file "top.sv" in my workspace:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I run the CLI command:
      """
      svsch render top.sv --output top_no_layout.svg --no-layout
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      top_no_layout.svg
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering top_no_layout.svg without a layout file
      """
    And a file named "top_no_layout.svg" should exist in the workspace
    And the CLI SVG should contain "port:top:a"
    And the CLI SVG should have node "a" positioned in its initial location

  Scenario: Render with multiple files and dependencies
    Given I have the following files in my workspace:
      | file   | content                                                           |
      | sub.sv | module sub(input a, output y); assign y = ~a; endmodule           |
      | top.sv | module top(input i, output o); sub u_sub(.a(i), .y(o)); endmodule |
    When I open the "top" module in SVSCH
    And I run the CLI command:
      """
      svsch render top.sv --output multi.svg --no-layout
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      multi.svg
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering multi.svg without a layout file
      """
    And a file named "multi.svg" should exist in the workspace
    And the CLI SVG should contain "instance:top:u_sub"
    And the CLI SVG should contain "sub"

  Scenario Outline: Output file name
    Given I have a file "top.sv" in my workspace:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I run the CLI command:
      """
      <command>
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      <expected_file>
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering <expected_file> without a layout file
      """
    And a file named "<expected_file>" should exist in the workspace

    Examples:
      | command                            | expected_file |
      | svsch render top.sv --no-layout    | top.svg       |
      | svsch render top.sv -o custom.svg  | custom.svg    |
      | svsch render top.sv --output o.svg | o.svg         |

  Scenario: Batch rendering to a directory
    Given I have the following files in my workspace:
      | file   | content                                               |
      | a.sv   | module a(input i, output o); assign o = i; endmodule  |
      | b.sv   | module b(input i, output o); assign o = ~i; endmodule |
      | decoy.txt | this is not an HDL file                            |
    When I open the "a" module in SVSCH
    And I run the CLI command:
      """
      svsch render "*.sv" --output-dir out --no-layout
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      out/a.svg
      out/b.svg
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering out/a.svg without a layout file
      [svsch] rendering out/b.svg without a layout file
      """
    And a file named "a.svg" should exist in directory "out"
    And a file named "b.svg" should exist in directory "out"
    And a file named "decoy.svg" should not exist in directory "out"

  Scenario: Selecting a top module
    Given I have a file "top.sv" in my workspace:
      """sv
      module first(input a, output y); assign y = a; endmodule
      module second(input b, output z); assign z = ~b; endmodule
      """
    When I open the "first" module in SVSCH
    And I run the CLI command:
      """
      svsch render top.sv --top second --output second.svg --no-layout
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      second.svg
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering second.svg without a layout file
      """
    And a file named "second.svg" should exist in the workspace
    And the CLI SVG should contain "port:second:b"
    And the CLI SVG should not contain "port:first:a"

  Scenario: Using an explicit layout file
    Given I have a file "top.sv" in my workspace:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I have saved the layout to "my_layout.json"
    And I run the CLI command:
      """
      svsch render top.sv --layout my_layout.json --output explicit.svg
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      explicit.svg
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering explicit.svg using layout file my_layout.json
      """
    And a file named "explicit.svg" should exist in the workspace
    And the CLI SVG should contain "port:top:a"
    And the CLI SVG should have node "a" positioned as it is on the diagram

  Scenario Outline: SVG themes
    Given I have a file "top.sv" in my workspace:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I open the "top" module in SVSCH
    And I run the CLI command:
      """
      svsch render top.sv --theme <theme> --output theme.svg --no-layout
      """
    Then the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering theme.svg without a layout file
      """
    And a file named "theme.svg" should exist in the workspace
    And the CLI SVG should contain "<bg_color>"

    Examples:
      | theme | bg_color                              |
      | dark  | --vscode-editor-background: #1e1e1e |
      | light | --vscode-editor-background: #ffffff |

  Scenario: Overriding Workspace root (affects layout discovery)
    Given I have the following files in my workspace:
      | file       | content                                               |
      | src/top.sv | module top(input a, output y); assign y = a; endmodule |
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I have saved the layout to "src/.svsch/layout.json"
    And I run the CLI command:
      """
      svsch render src/top.sv --workspace src --output out.svg
      """
    Then the CLI stderr should be exactly:
      """
      [svsch] Using custom Workspace root: src
      [svsch] Elaborating project...
      [svsch] Elaborating project...
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering out.svg using layout file src/.svsch/layout.json
      """
    And a file named "out.svg" should exist in the workspace
    And the CLI SVG should have node "a" positioned as it is on the diagram

  Scenario: Using --svsch-data-dir to find a module's layout independent of --workspace
    Given I have the following files in my workspace:
      | file       | content                                                 |
      | src/top.sv | module top(input a, output y); assign y = a; endmodule |
    When I open the "top" module in SVSCH
    And I move the port node "a"
    And I run the CLI command:
      """
      svsch render src/top.sv --workspace src --svsch-data-dir .svsch --output out.svg
      """
    Then the CLI stderr should be exactly:
      """
      [svsch] Using custom Workspace root: src
      [svsch] Using custom SVSCH data directory: .svsch
      [svsch] Elaborating project...
      [svsch] Elaborating project...
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering out.svg using layout file .svsch/layouts/top.json
      """
    And a file named "out.svg" should exist in the workspace
    And the CLI SVG should have node "a" positioned as it is on the diagram

  Scenario: Specifying Project folder (affects source collection)
    Given I have the following files in my workspace:
      | file         | content                                                              |
      | sub/child.sv | module child(input i, output o); assign o = i; endmodule             |
      | top.sv       | module top(input a, output y); child u_child(.i(a), .o(y)); endmodule |
    When I open the "top" module in SVSCH
    And I run the CLI command:
      """
      svsch render top.sv --project-folder . --output out.svg --no-layout
      """
    Then the CLI stderr should contain "[svsch] Using custom Project folder: ."
    And the CLI stderr should contain "[svsch] Finalizing..."
    And a file named "out.svg" should exist in the workspace
    And the CLI SVG should contain "instance:top:u_child"
    And the CLI SVG should contain "child"

  Scenario: Single output with directory glob and top module
    Given I have the following files in my workspace:
      | file   | content                                                 |
      | a.sv   | module a(input i, output o); assign o = i; endmodule    |
      | b.sv   | module b(input i, output o); assign o = ~i; endmodule   |
    When I open the "a" module in SVSCH
    And I run the CLI command:
      """
      svsch render "*.sv" --top b --output single_b.svg --no-layout
      """
    Then the CLI stdout should be exactly (workspace-relative):
      """
      single_b.svg
      """
    And the CLI stderr should be exactly:
      """
      [svsch] Using cached design data
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] rendering single_b.svg without a layout file
      """
    And a file named "single_b.svg" should exist in the workspace
    And a file named "a.svg" should not exist in the workspace
    And a file named "b.svg" should not exist in the workspace

  Scenario: Project folder isolation
    Given I have the following files in my workspace:
      | file         | content                                                              |
      | sub/child.sv | module child(input i, output o); assign o = i; endmodule             |
      | top.sv       | module top(input a, output y); child u_child(.i(a), .o(y)); endmodule |
    When I open the "top" module in SVSCH
    And I record the workspace directory state
    And I run the CLI command:
      """
      svsch render top.sv --project-folder sub --output out.svg --no-layout
      """
    Then the CLI stderr should be exactly:
      """
      [svsch] Using custom Project folder: sub
      [svsch] Elaborating project...
      [svsch] Elaborating project...
      [svsch] Extracting design graph...
      [svsch] Finalizing...
      [svsch] No modules from "top.sv" were found in the project graph. Check --project-folder or --workspace.
      """
    And the workspace directory state should remain unchanged
