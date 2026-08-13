---
"svsch": patch
---

Regenerate the syntax-book, visual-regression, and CLI snapshot fixtures that were left stale by the webview CSS split (#157) — they still embedded webview-chrome-only rules (`.shell`, `.busy-indicator`, `.toolbar`, etc.) that no longer belong in exported SVG output since those selectors never match anything in the exported document.
