---
"svsch": patch
---

Render a dynamic-input chevron on the clock port and every other signal in a compound `always_ff` event expression, with a polarity bobble for `negedge` signals. Fixes a lone single-signal sensitivity list not being classified as the clock, and an unmatched compound event wrongly promoting one signal into an unlabeled clock slot while its siblings rendered as plain text.

Also fixes the wire routing for that case: the ELK layout geometry still had the old positional fallback that guessed the first non-D/reset/RV signal was the clock, so it routed that wire to the clock row while the node itself (which has no such fallback) drew the matching chevron one row further down -- every wire in an unmatched compound event landed a full row off from the port it was meant to connect to.
