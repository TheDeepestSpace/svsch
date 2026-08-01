---
"svsch": patch
---

Fix cut-net-end label highlighting so a marquee-selected block no longer lights up its attached (but unselected) net label's halo/hovered-text. React Flow auto-selects a label's stub edge whenever the block it's attached to is selected; only genuine hover or the label's own `selected` prop now drives the highlight.
