Feature: Command Line Interface

  Scenario: Help command output
    When I run the CLI command:
      """
      svsch --help
      """
    Then I see the following CLI output:
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
            --surelog <path>      Surelog executable path
            --backend <path>      svsch_backend executable path
            --workspace <dir>     Workspace root used for parser cache and relative paths
            --project-folder <d>  Project folder relative to workspace
      """

  Scenario: Basic schematic rendering
    Given I have opened "top.sv" for editing with:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I run the CLI command:
      """
      svsch render top.sv --output top.svg --no-layout
      """
    Then the CLI output should contain "port:top:a"
    And the CLI output should contain "port:top:y"

  Scenario: Render with manual layout
    Given I have opened "top.sv" for editing with:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I position the port node "a" at (120, 468)
    And I have saved the layout
    And I run the CLI command:
      """
      svsch render top.sv --output top_with_layout.svg
      """
    Then the CLI output should contain "port:top:a"
    And the CLI output should contain "transform=\"translate(120 468)\""

  Scenario: Render without manual layout (--no-layout)
    Given I have opened "top.sv" for editing with:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I position the port node "a" at (120, 468)
    And I have saved the layout
    And I run the CLI command:
      """
      svsch render top.sv --output top_no_layout.svg --no-layout
      """
    Then the CLI output should contain "port:top:a"
    And the CLI output should not contain "transform=\"translate(120 468)\""

  Scenario: Render with multiple files and dependencies
    Given the following SystemVerilog files:
      | file   | content                                                           |
      | sub.sv | module sub(input a, output y); assign y = ~a; endmodule           |
      | top.sv | module top(input i, output o); sub u_sub(.a(i), .y(o)); endmodule |
    When I run the CLI command:
      """
      svsch render top.sv --output multi.svg --no-layout
      """
    Then the CLI output should contain "instance:top:u_sub"
    And the CLI output should contain "sub"
    And there should be a connection between "i" and "u_sub"
    And there should be a connection between "u_sub" and "o"

  Scenario Outline: Output file name
    Given I have opened "top.sv" for editing with:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I run the CLI command:
      """
      <command>
      """
    Then the CLI should have reported generating "<expected_file>"
    And a file named "<expected_file>" should exist in the workspace

    Examples:
      | command                            | expected_file |
      | svsch render top.sv --no-layout    | top.svg       |
      | svsch render top.sv -o custom.svg  | custom.svg    |
      | svsch render top.sv --output o.svg | o.svg         |

  Scenario: Batch rendering to a directory
    Given the following SystemVerilog files:
      | file   | content                                                 |
      | a.sv   | module a(input i, output o); assign o = i; endmodule    |
      | b.sv   | module b(input i, output o); assign o = ~i; endmodule   |
    When I run the CLI command:
      """
      svsch render "*.sv" --output-dir out --no-layout
      """
    Then a file named "a.svg" should exist in directory "out"
    And a file named "b.svg" should exist in directory "out"

  Scenario: Selecting a top module
    Given I have opened "top.sv" for editing with:
      """sv
      module first(input a, output y); assign y = a; endmodule
      module second(input b, output z); assign z = ~b; endmodule
      """
    When I run the CLI command:
      """
      svsch render top.sv --top second --output second.svg --no-layout
      """
    Then the CLI output should contain "port:second:b"
    And the CLI output should not contain "port:first:a"

  Scenario: Using an explicit layout file
    Given I have opened "top.sv" for editing with:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I position the port node "a" at (768, 900)
    And I have saved the layout to "my_layout.json"
    And I run the CLI command:
      """
      svsch render top.sv --layout my_layout.json --output explicit.svg
      """
    Then the CLI output should contain "port:top:a"
    And the CLI output should contain "transform=\"translate(768 900)\""

  Scenario Outline: SVG themes
    Given I have opened "top.sv" for editing with:
      """sv
      module top(input a, output y);
        assign y = a;
      endmodule
      """
    When I run the CLI command:
      """
      svsch render top.sv --theme <theme> --output theme.svg --no-layout
      """
    Then the CLI output should contain "<bg_color>"

    Examples:
      | theme | bg_color                           |
      | dark  | --vscode-editor-background: #1e1e1e |
      | light | --vscode-editor-background: #ffffff |

  @todo
  Scenario: Overriding Surelog path
    When I run the CLI command:
      """
      svsch render top.sv --surelog /custom/path/to/surelog --output out.svg
      """
    Then the CLI should have used the custom Surelog path

  @todo
  Scenario: Overriding Backend path
    When I run the CLI command:
      """
      svsch render top.sv --backend /custom/path/to/backend --output out.svg
      """
    Then the CLI should have used the custom Backend path

  @todo
  Scenario: Overriding Workspace root
    When I run the CLI command:
      """
      svsch render src/top.sv --workspace src --output out.svg
      """
    Then the CLI should have used "src" as the workspace root

  @todo
  Scenario: Specifying Project folder
    When I run the CLI command:
      """
      svsch render proj/top.sv --project-folder proj --output out.svg
      """
    Then the CLI should have focused on the "proj" folder

