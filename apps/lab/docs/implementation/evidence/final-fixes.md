# Final combined fix wave — 2026-11-01

Completed in isolated worktrees only:
- Lab `/tmp/mekoniq-robot-lab-work/lab`, branch `feat/robot-lab`.
- Source `/tmp/mekoniq-robot-lab-work/source`, branch `feat/robot-lab-runtime`.

Original `/Users/hoangpham/source/prv/robot/source` and operational services were not mutated. No subagents were spawned.

## Commits and runtime pin

- Source: `56133dd02dd19cb19f22be0fbc720731646e6674` — `fix: preserve causal order in lab runtime read models`.
- Lab: `aa37e3269156b89904d150a67f8061051959f910` — `fix: bound project rendering and preserve active editor state`.
- Clean artifact output: `/tmp/mekoniq-source-runtime-artifact`.
- Artifact SHA-256: `55c46b30c524b2a427cbca507558d3fbee84ca5cdcdf2a8b8d8ba5d266fec88e`.
- Schema hash unchanged: `4fcdf0bf1cd93bacf891a5429f0e593a2049e12c584f4e6c967b1a6bb4454d91`.
- Source artifact metadata declares `dirty:false`, Node major 24, protocol major 1.
- Lab imported the clean artifact and committed `config/source-runtime.lock.json`.

## Exact changes

1. Source `LabSession.orderedJournal()` sorts durable single-producer journal entries by `BigInt(entry.sequence)` at the session read boundary. Both snapshot flattening and report journal use it. Event order within each signed entry is preserved; signatures and stored entries are not rewritten. No timestamp-only sorting.
2. Lab structural import now bounds tray counts to integer 1–10, battery/payload to 0–1000, world dimensions to >0 and <=1000. These numeric limits match the published source project schema. Existing byte/object limits remain. SVG and Three.js tray generation independently clamp iteration to 10; map label generation independently clamps to 1001 labels. Invalid imports fail before persistence or current/history selection changes.
3. Centralized `selectProject()` sets the active project and persists its ID, normalizing the world selection. Startup, ordinary edits, imports, undo, and redo use it. Selection storage failures show the existing browser-storage warning. Undo/redo saves use the existing autosave-warning behavior rather than uncaught save rejections.
4. World selection is normalized whenever a selected project or rendered world changes. An empty world renders a translated empty-state editor while retaining Add and geometry issues. Coordinate submissions validate that the selected point still exists before changing history or project state. Different imported IDs and undo/redo no longer display and edit different points.

## Targeted red-to-green evidence

- New source regression initially failed with `expected 2 to be greater than 15`, proving the durable TEXT-sequence lexical-order leak.
- New import/store tests initially accepted 4294967296 and max-safe-integer trays, enormous dimensions, and out-of-range numeric design inputs; fallback directly threw `RangeError: Invalid array length` for 4294967296 trays.
- Browser reproductions before the editor fixes: imported and redo-selected identities reverted on reload; empty-world Restaurant rendering failed; editing an imported new-point left x=2 rather than x=4.2.
- Extended real pinned-runtime browser E2E initially failed with `INVALID_REPORT` in the actual Lab consumer. After the source fix and clean artifact repin, it passes.

## Final validation

All commands used Node `v24.22.2` with `PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH` and pnpm `10.32.1`.

Source:
- `pnpm exec vitest run tests/integration/lab-runtime*.test.ts tests/integration/simulated-delivery.test.ts tests/integration/app-simulator.test.ts tests/contracts/signing.test.ts tests/contracts/wire.test.ts` — **36/36 passed**, 8 files (prior 35 plus new numeric causal-order regression).
- `pnpm typecheck` — **passed**, full workspace tsc.
- `pnpm contracts:check` — **passed**, generated contracts match schemas.
- `node scripts/export-lab-runtime.mjs /tmp/mekoniq-source-runtime-artifact` — **passed**, clean source commit artifact.

Lab:
- `node scripts/import-runtime.mjs /tmp/mekoniq-source-runtime-artifact` — **passed**.
- `pnpm check:source` — **passed**, commit/schema/Node pin verified.
- `pnpm typecheck` — **passed**; subsequent full build also reran tsc over final sources/tests.
- `pnpm test:unit` — **34/34 passed**, 5 files.
- `pnpm test:integration` — **8/8 passed**, 2 files.
- `pnpm exec playwright test ui.spec.ts` — **12/12 passed** (the six original checks plus import/reload, undo/reload, redo/reload, huge numeric rejection/state preservation, empty-world add/edit/history, and changed-ID editing/history).
- `pnpm test:runtime-e2e` — **1/1 passed**, actual source runtime and fresh temporary SQLite journal. This test is not skipped.
- `pnpm build` — **passed**.
- `git diff --check` — **passed** before each implementation commit.

The real S01 browser journey now explicitly advances simulation time while awaiting human confirmations: 2000ms waiting to load and 3000ms waiting to hand off. It asserts:
- Elapsed **8000ms**, travel **3000ms**, human wait **5000ms**.
- Served **1**, execute attempts **3**.
- Visible UI metrics **3.0s**, **5.0s**, **3**, and absence of the invalid-report message.
- More than nine journal entries in increasing BigInt sequence, initial SessionOpened event, valid ordered read-only replay, and no action requests during replay.
- Downloaded report equals the source evidence; candidate download and bundle validation remain passing.
- Existing frozen-world presentation/editing assertions remain passing.

UI numeric rejection tests import from Deployment and assert unchanged current exported project before navigating to mesh rendering, avoiding dangerous allocation if admission regresses. Inputs include 4294967296 and max-safe-integer trays, world width 1e20, and max-safe-integer world height. Reload confirms the usable persisted project is unchanged.

## Limits and remaining root work

- Numeric admission limits bound structural work; they do not validate engineering readiness. Bounded incomplete drafts such as 10 trays, 0Ah, missing stations, or empty points remain editable and report existing design/geometry issues. Source run admission remains stricter and requires valid scenario stations/target geometry. Full schema parity beyond these numeric work bounds was not expanded in this fix wave.
- Ordinary offline UI tests log expected health-proxy ECONNREFUSED when no runtime runs. Browser page-error assertions pass. Playwright logs the existing FORCE_COLOR/NO_COLOR warning. Vite retains its existing optional Three.js chunk >500kB warning; build passes.
- No new native capability, physical safety claim, source apply/rollback, SSE, additional scenario, or full G1 acceptance was introduced.
- Source worktree is clean after its commit. Lab leaves only root-owned `docs/plans/2026-11-01-mekoniq-robot-lab.md` modified and `docs/implementation/evidence/` untracked; these were deliberately not staged.
- Root should update final docs/evidence and obtain its planned final review. No review agent was spawned here.
