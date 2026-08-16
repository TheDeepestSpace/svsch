---
"svsch": patch
---

Fix stacked-instance nodes keeping stale port/edge geometry after a resize drag. React Flow's internal `node.measured` dimension could stay on its pre-resize value when rapid-fire `updateNodeInternals` calls during a multi-step drag raced each other in React Flow's store, most noticeably on slower-to-render stacked/array instance nodes. An extra forced update is now scheduled via `requestAnimationFrame` once the drag's call flurry has drained.
