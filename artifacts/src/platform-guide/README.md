# Source + Lab product/deployment guide

Standalone Vietnamese HTML: `artifacts/mekoniq-platform-lab-guide-2026-11-06.html`.

54 reporting groups (F01–F30 + L01–L24), 21 real screenshots, local runbook and the two existing Vercel projects with Supabase. All image pixels/CSS/JS are embedded; links to repository documents require the sibling source/lab workspace. No credentials are embedded. Project dashboard URLs and Supabase API URL were supplied by the user; authenticated deployment settings and production domains were not inspected.

Build from `source/`:

```sh
python3 artifacts/src/platform-guide/build.py
node --check artifacts/src/platform-guide/app.js
node artifacts/src/platform-guide/verify.cjs
```

Use Node 24.22.2 and the repository Playwright dependency. `PLAYWRIGHT_CHROMIUM` can select another installed Chrome. Verification checks document behavior and shell syntax; it does not execute deployment commands or rerun application test suites.

`capture.cjs` takes ten new screenshots from isolated local services already started by the operator: tablet/coordinator 3452/3451 and Lab Vite 4175. Capture uses a dedicated fixture lab ID. It does not start or stop services. The builder copies eleven archived screenshots from `.lab/shots` and Lab evidence, falling back to the saved copies in `screenshots/` when the originals are unavailable. Do not label archived source UI as newly tested or hosted production. `capture-manifest.json` records fresh captures; `screenshots-manifest.json` also records archived origin and image SHA-256. The generated HTML itself needs none of the original files.

`feature-inventory.json` and `build-manifest.json` are generated. Edit content in `build.py`, presentation in `style.css`, interactions in `app.js`. Existing multilingual presentations and the earlier Digital Twin report are unchanged.

Runtime/application qualification data is read from the latest BV01 implementation summary; historical test passes are explicitly labeled. Native engines, clean-machine acceptance, usability and hardware remain separate open gates.
