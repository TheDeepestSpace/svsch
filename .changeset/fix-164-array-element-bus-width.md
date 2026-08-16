---
"svsch": patch
---

Fix bus composition nodes synthesized from multi-bit unpacked-array elements (e.g. `logic [7:0] arr [3:0]` driven element-by-element and read back as a whole) collapsing each element's width to 1 bit. The composer now uses the array's declared element width instead of treating the `[i]` index as a packed-bus bit slice.
