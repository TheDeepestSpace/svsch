---
"svsch": minor
---

Assign chains (`wire a, b, c; assign a = b; assign b = c; ...`) now report the earliest-declared internal wire/reg name in the chain (preferred over any port it aliases through), with every other name it collapsed through available on hover. An ordinary, uncut wire now shows this declared name directly whenever it differs from both of its endpoints — e.g. `wire x; assign x = a; assign y = x;` labels the wire "x" — since otherwise that name would never appear anywhere in the diagram. Cut-net labels prefer a net's real SV-declared name over a guessed one, and a label backed by a real declared name renders in regular type and can no longer be renamed, while a tool-invented label (e.g. `NET_3`) stays italic and freely renameable.
