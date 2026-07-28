---
"svsch": minor
---

CLI: log which layout file (if any) was used for each rendered SVG, e.g. `[svsch] rendering out.svg using layout file .svsch/layouts/top.json` or `[svsch] rendering out.svg without a layout file`. Add a `--svsch-data-dir <dir>` flag so a module's per-module layout under `<dir>/layouts/<module>.json` can be found without spelling out the full path — useful now that layouts live one file per module under `.svsch/layouts/`.
