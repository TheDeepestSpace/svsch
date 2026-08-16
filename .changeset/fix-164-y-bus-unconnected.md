---
"svsch": patch
---

Fix a continuous-assign bug where composing a packed output bus bit-by-bit from array-element reads (e.g. `assign y_bus[i] = y_arr[i];`) dropped the driving edges entirely, leaving the output port unconnected. The alias node representing each bit was deleted before the later pass that stitches those bits into the bus had a chance to consume it.
