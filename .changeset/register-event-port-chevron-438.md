---
"svsch": patch
---

Render a dynamic-input chevron on the clock port and every other signal in a compound `always_ff` event expression, with a polarity bobble for `negedge` signals. Fixes a lone single-signal sensitivity list not being classified as the clock, and an unmatched compound event wrongly promoting one signal into an unlabeled clock slot while its siblings rendered as plain text.
