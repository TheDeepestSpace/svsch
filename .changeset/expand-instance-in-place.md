---
"svsch": minor
---

Add "Expand" to the selection toolbar for a single selected instance node: unfolds that instance's own module diagram in place inside the parent canvas, recursively, with no depth cap. Boundary ports render as label-only nodes with a wire stub on each side; the expanded region supports the same drag-to-move/auto-grow behavior as generate-region blocks and persists its layout per-instance, separately from the child module's own standalone view. Array-of-instances nodes are not yet supported (tracked in #169). A "Collapse" control on the expanded region's header reverts it back to a normal instance node.
