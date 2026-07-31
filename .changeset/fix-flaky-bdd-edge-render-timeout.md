---
"svsch": patch
---

Fix edges intermittently failing to render (no `.react-flow__edge` DOM elements, timing out in CI) right after opening a module. React Flow only learns a node's handle positions from a `ResizeObserver` callback that fires on its own, browser-scheduled timing after the node's DOM mounts — under a busy renderer that callback can be delayed arbitrarily, during which no edges can be drawn even though the node/edge data model is already complete. Since the node/handle geometry is already valid the instant the DOM commits (layout doesn't require a paint), the webview now measures it synchronously itself right after nodes mount, instead of waiting on that observer's own scheduling.
