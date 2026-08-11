---
"svsch": patch
---

Fix snapshot update scripts silently overwriting baselines with sub-threshold noise instead of comparing first, and add a CI gate that rejects screenshot baseline updates whose diff is at or under the test's own threshold.
