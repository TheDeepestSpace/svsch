---
"svsch": minor
---

Assign chains (`wire a, b, c; assign a = b; assign b = c; ...`) now report the earliest-declared name in the chain, with every other name it collapsed through available on hover. Cut-net labels prefer a net's real SV-declared name over a guessed one, and a label backed by a real declared name renders in regular type and can no longer be renamed, while a tool-invented label (e.g. `NET_3`) stays italic and freely renameable.
