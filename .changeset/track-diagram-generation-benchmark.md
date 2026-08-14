---
"svsch": patch
---

Track diagram-generation duration in CI with `github-action-benchmark` so performance regressions are caught automatically. PR runs post one combined comment covering the system/visual suites instead of two separate ones, with a worst/best delta table per suite; visual gets a per-test stacked "elaboration + rendering" bar chart (fastest to slowest), system gets a per-test "baseline vs. this run" bar chart. The visual suite times every test that renders a diagram (previously only fixture-based tests were covered) and reports elaboration (Surelog/UHDM parse) and rendering (webview paint) as separate metrics; the system suite reports one entry per vscode-version instead of only the latest. BDD perf tracking was removed — its timings were dominated by a fixed busy-indicator wait rather than real work (see #167).
