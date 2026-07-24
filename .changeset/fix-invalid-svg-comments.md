---
"svsch": patch
---

Fix exported/generated SVGs being malformed XML: a couple of source comments in the embedded stylesheet contained literal `<...>` tag references, which is invalid inside an SVG `<style>` element without CDATA wrapping. Browsers render it anyway, but strict XML consumers (e.g. GitHub's SVG preview) rejected the whole file.
