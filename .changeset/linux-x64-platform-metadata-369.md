---
"svsch": patch
---

Add `os`/`cpu` restrictions (`linux`/`x64`) to `package.json` so `npm install -g svsch` fails fast with a clear "Unsupported platform" error instead of installing a broken CLI on macOS, Windows, or arm64. Document the Linux x86_64-only requirement in the README, since the bundled Surelog binary and native diagram backend are prebuilt for that platform only.
