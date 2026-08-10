---
"svsch": patch
---

Track diagram-generation duration in CI with `github-action-benchmark` so performance regressions are caught automatically. PR runs post one combined comment covering the system/bdd/visual suites instead of three separate ones, with a per-test "baseline vs. this run" bar chart and a worst/best delta table per suite. The visual suite now times every test that renders a diagram (previously only fixture-based tests were covered) and reports elaboration (Surelog/UHDM parse) and rendering (webview paint) as separate metrics; the system suite reports one entry per vscode-version instead of only the latest.
