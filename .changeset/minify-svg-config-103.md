---
"svsch": minor
---

Add `svsch.minifySvg` config (default on) gating SVGO minification of exported SVGs. Minification runs at export write points (CLI render, extension's exportSvg) — use `--no-minify` in the CLI to opt out.
