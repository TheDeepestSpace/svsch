---
"svsch": patch
---

Fix array-stack lead stubs being asymmetric between the sink and source sides by sharing a single geometry helper for both `SvgArrayStackLeads` and `NetLabelWire`.
