---
"svsch": patch
---

Fix interface type labels falling back to the browser's serif default instead of the editor font. `.svsch-interface-type-label` had no `font-family`, so it inherited nothing from its SVG ancestors; now set to `var(--vscode-editor-font-family, monospace)` to match the rest of the diagram's text.
