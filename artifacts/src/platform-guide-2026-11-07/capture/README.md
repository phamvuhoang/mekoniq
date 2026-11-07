# Fresh guide captures

Capture tooling for this guide. The committed capture-manifest.json records the actual executed captures, hashes, timestamps and environments. Run these scripts only after competing tests finish and after verifying the release code revisions and runtime pin; a documentation-only HEAD is distinct from the tested release code.

Use Node 24, installed Chrome, and the workspace's existing dependencies. Run sequentially. Screenshots are real UI captures; partial captures remain in their category manifest if a later step fails. Each entry has id/title/file/repo/environment/url/capturedAt/revision/runtimePin/scope/sha256/width/height. `runtimePin` is the runtime source commit string for actual compiler/Twin/results shots and null for public, Source, assembly design and estimates shots. The full runtime lock stays internal for identity checks. The `file` is `screenshots/<id>.png`; choose the final screenshots folder accordingly.

```sh
export MEKONIQ_WORKSPACE=/absolute/path/to/robot
export GUIDE_CAPTURE_SCRIPTS="$MEKONIQ_WORKSPACE/source/artifacts/src/platform-guide-2026-11-07/capture"
export GUIDE_SCREENSHOTS_DIR="$MEKONIQ_WORKSPACE/source/artifacts/src/platform-guide-2026-11-07/screenshots"
export GUIDE_SOURCE_REVISION='<final full source HEAD>'
export GUIDE_LAB_REVISION='<final full lab HEAD>'
export GUIDE_RUNTIME_PIN_FILE="$MEKONIQ_WORKSPACE/lab/config/source-runtime.lock.json"
export GUIDE_LAB_PUBLIC_URL='https://mekoniq-lab.vercel.app/'

node "$GUIDE_CAPTURE_SCRIPTS/public.cjs"
cd "$MEKONIQ_WORKSPACE/source"
node --import ./node_modules/tsx/dist/loader.mjs "$GUIDE_CAPTURE_SCRIPTS/cloud.mjs"
```

The cloud script asks local Supabase status for its keys without printing them, force-selects the local PostgreSQL admin endpoint 57422, rejects a Supabase API outside loopback 57421, creates a random tenant and throwaway auth owner using maintained test helpers, and starts/stops its own ephemeral Next dev process. It captures settings empty/preset plus catalog applied/pending, then deletes the actor and its tenant rows. `setupWave02` may apply missing local test migrations, matching existing e2e fixtures. It never uses production database data. Do not run concurrently with cloud tests sharing Next output. Existing local Supabase must already be running.

For tablet captures, root starts these two isolated dev services (if not already running with these exact fixture settings) in separate processes, retaining their PIDs for cleanup:

```sh
cd "$MEKONIQ_WORKSPACE/source"
MEKONIQ_DEV_LAB=1 COORDINATOR_PORT=3451 node --import ./node_modules/tsx/dist/loader.mjs tests/support/coordinator-server.ts
cd "$MEKONIQ_WORKSPACE/source/apps/tablet-web"
MEKONIQ_DEV_LAB=1 node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3452 --strictPort
```

Then:

```sh
node "$GUIDE_CAPTURE_SCRIPTS/tablet.cjs"
```

The tablet script uses a unique `lab` query parameter for fixture isolation and follows real POS -> KDS -> bill creation before taking populated screenshots. It also captures fleet/inventory/device. This leaves synthetic journal state only in the owned coordinator's temporary fixture; root should stop its two owned service processes afterward.

For Lab, ensure 4175/4176 are free, and the installed runtime matches the final lock. This wrapper validates and starts the installed pinned runtime entrypoint directly with a temporary journal and explicit `--engineering-catalog source/robotics/catalog`, `--engineering-simulation source/robotics/simulation`, and `--engineering-python source/.venv/bin/python` absolute paths. It starts a separately owned Vite process on 4175, handles the runtime CLI's one-use token entirely in memory, suppresses all raw service logs, runs captures, and stops both owned processes afterward. The Python environment must already contain the compiler dependencies; the wrapper installs nothing and sets `PYTHONDONTWRITEBYTECODE=1`.

```sh
node "$GUIDE_CAPTURE_SCRIPTS/run-lab.cjs"
```

Alternatively root may start its own runtime/UI with those same explicit engineering flags and run `lab.cjs` with `LAB_TEST_PAIRING_TOKEN_FILE` pointing to a mode-0600 temporary token file; delete it afterward. The default `start-mock.mjs` launcher does not enable engineering compilation and is insufficient here. Do not echo or store the token in a committed artifact. The capture script asserts the token input disappeared before any shot, checks runtime sourceCommit and schemaHash against the lock, opens FD01 reference assembly, shows honest estimates, requires an actual successful engineering compile receipt and rendered scene, then completes a BV01 MOCK coffee run and captures its real report. Runtime health at `/lab/v2/health` exposes flat `sourceCommit`, `schemaHash`, `protocolMajors`, and `capabilities` fields; the wrapper checks all four and checks only mock backends are enabled. All compiler screenshots say `local-compiler-preview`; scopes disclaim native physics and hardware evidence. The scripts do not substitute route fakes or fabricated screenshots.

Root must inspect the actual PNGs for legibility and expected UI, merge the four `capture-*.json` arrays into the guide manifest, and run the guide's existing acceptance checks. Public capture manifest revisions identify the accompanying repo snapshot; the scope explicitly says deployment commit was not independently verified. Preserve that caveat unless root obtains deployment commit evidence. Root may rename shots only while updating file/id references and recomputing SHA metadata. No script changes the guide itself.
