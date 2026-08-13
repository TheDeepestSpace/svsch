---
"svsch": patch
---

Split webview styles.css into shared diagram.css and webview-chrome.css so exported SVGs no longer embed unused toolbar/panel CSS, shrinking exported SVGs by ~25-30%.
