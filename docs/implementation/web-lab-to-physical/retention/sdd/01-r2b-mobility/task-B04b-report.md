# B04b — Lab MuJoCo mobile payload experience

Status: DONE — implementation and focused verification complete; independent task review belongs to the controller. No source API change or unresolved test failure. Scope is the authorized Lab worktree only; source changes below this ignored handoff directory are absent. Original main checkouts, trial/web, historical evidence, operational ports1880/1884 and hardware untouched. No push/merge/deploy/provisioning or qualification acceptance.

## Revisions and runtime

- Source BASE=HEAD `681b8adb8ed473f7195062773b23fabc3b922cd5` (unchanged).
- Lab BASE `cbeb5817cd65d53182aa080df3e566ad656d4945`; final commit recorded at the end after commit.
- Both authorized worktrees remain on `codex/web-lab-to-physical`.
- The already reviewed/exported/pinned B04a runtime is reused: `/tmp/mekoniq-b04a-681b8ad-export-20261114-0954`, artifact `9151185264c5d86b29c73591ccc9433a30d07929546e1d28ce843f825d650b53`, schema `d7cd5fbe76e1800e1e17d26d829c05569989ff44498482400c114a10c3842506`. No re-export or Lab pin commit needed for Lab-only UI/scripts.
- Node24.22.2/pnpm10.32.1; native Python3.11.15/MuJoCo3.17.0/darwin-arm64. Three remains0.180.0. Native launches serialized, all commands bounded, bytecode/cache disabled. No subagents or reviewers spawned.

## Product behavior and admission

`pnpm lab:mujoco -- --mujoco-mobile` starts the real pinned mobile+arm runtime and Lab. The explicit flag verifies pinned portable closure, MuJoCo venv and the compiler helper's pinned `.venv-irsim`, creates the server-owned Serve catalogue, and requires mobile engineering capabilities/readiness. Default `pnpm lab:mujoco` retains the arm-only path without optional compiler/catalogue prerequisites. README gives both launch and recorded replay preparation commands.

`mujoco-payload` is center load/seed7/default1×. It offers exactly seven registered experiment IDs, rather than independent arbitrary load/speed/friction inputs. Compilation/readiness belongs to the exact current draft; stale/out-of-order replies are discarded. Selection creates new project/bundle/run identities; empty means no payload. Generic mock fault and arbitrary speed-limit draft controls are omitted for this preset. Playback × only changes pacing. Source navigation kinematics remain authority for applied speed caps.

**Initial observation ruling:** POST /runs creates a ready run; Source start performs the actual worker create/priming and commits tick0 before any logical step. Lab auto-starts through that Source action but, for this payload preset, no longer sends the inherited unpaced250-tick bootstrap. The native test proves the Source start response contains the payload at tick0, then fetches a real `physics_sim`/`map`/`valid` sample with `simTimeNs:'0'`, matching boot and physics manifest coverage0. The canvas equals that observation. Only explicit Play then advances the Source clock at1×. No fixture cup pose is used as a native observation. Native priming and B03 interval conventions are unchanged.

The payload adapter validates the synced scene/model/load/sample schemas; document digests and file-byte hashes; canonical Serve mechanics; admitted center/offset/empty supports and props; and unit quaternions. A rehashed substituted load shape is rejected. Profile identities use exact file-byte SHA256s, not document/numerical digests. Browser reports with mobile provenance cannot claim calibrated hardware. Every mobile telemetry geometry/pose consumed is validated; foreign provider, malformed geometry/quaternion/digest, wrong binding/run/boot/profile and corrupt present artifacts are refused.

Serve visuals and trays come from admitted physical links and base-frame transforms. The group follows Source base height/yaw/roll/pitch; a free payload is an independent entity `payload:cup-1` using its own admitted cylinder geometry and committed map pose. Canonical transforms cross map-Z-up/Three-Y-up once. No client physics, wheel animation, motion interpolation for mobile samples, or coffee ledger/custody inference. Missing bundle geometry is unavailable rather than a generic mobile-body proxy. Added GPU resources follow existing free/dispose ownership. Existing object selection/Fit frames the actual-sized cup between trays; physical dimensions are never enlarged.

B03 PhysicsReportBlock is reused. The report/timeline expose source aggregates and unavailable reasons. Earlier cursors hide final metrics/fault reasons, and never interpolate through gaps. Payload replay uses logical `step=1`: the inherited slider's step5 had sanitized terminal284 to an adjacent tick and rendered another pose. Legacy cursor step5 stays unchanged. Native final284 is now selected exactly and its entire payload pose equals the live frozen view. Old reports without physics remain importable/unavailable. Contact/duration windows remain(0,lastTick], with tick0 initial pose/baseline and priming explained. Stop-distance labels start at plant zero target after ramp, never at the browser click. Low material input0.3 is explicitly masked by maximum mixing against floor0.8/cup0.6; no slippery-floor claim.

**Paused cancellation ruling (controller-approved):** journal cancel on the current run first, then resume only that paused simulation clock and observe bounded20-tick Source steps at1×, at most500ticks/10s, until Source cancels or reports attention. No new workload, controller edit, campaign five-sample tail, local terminal decision, slot release or respawn. Each await is guarded by run ID/view epoch/writer access. Errors/unknown/attention/budget stop the drain and retain actual state. A second user Pause stops the drain at its in-flight boundary, pauses that same Source clock, and leaves pending cancellation; it is never automatically resumed again. UI states that cancellation waits for an observed stop. The native run closes at Source's first stopped observation, leaving the ordinary five-sample stopDistance unavailable as expected.

`export-payload-replay.mjs CASE NEW_DIR` copies only public report, compiled project, bundle and hash-bound chunks from a retained campaign into a new folder. It does not read SQLite or copy journals/signing keys/worker state. The browser validates bound geometry/poses and present chunk hashes; all imported aggregate metrics are explicitly unavailable as `IMPORTED_METRICS_NOT_RECOMPUTED`, since browser hash checking is not metric recomputation/producer authentication. The original B04a cup-fall report is imported read-only and frozen at its last committed tick520, still in the air. No synthetic fault or continuing fall animation is added.

**Fault wireframe:** intentional stale-observation styling, not missing geometry. Original terminal sample is `quality:'stale'`, `reasonCodes:['PLANT_NOT_LIVE']`; exact admitted model/load hashes remain bound. Object list says “Recorded pose · frozen”; Engineering inspection exposes quality/reason and explains wireframe means stale observation while geometry stays the admitted model. Imported metric unavailability is separate from that pose/style. Named live stress selector/offline catalogue remain B07.

## TDD / failure evidence

Logs below are in this directory's `evidence-B04b/`. All filtered cases in focused RED runs are not_run, never counted as passes.

- `unit-red.log`: `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/payload-view.test.ts` before the module existed: missing-module collection RED,0tests. Subsequent first behavior run `unit-red-behavior.log` had3failed/3passed. Held browser timing fields needed stripping before wire-schema validation; a mistaken flat tray-height expectation was corrected to the actual tilted-support/canonical transform (not counted as a production defect).
- `race-red.log`: targeted out-of-order compile regression with the guard temporarily removed through an owned `/tmp` copy:1failed/6filtered, old center replaced newer empty. Guard restored; complete file GREEN. This is a sensitivity check, not claimed as a fresh missing implementation.
- `cancel-red.log`: paused-cancel helper absent,1failed/7filtered. Native browser had also demonstrated pending cancellation retained the active world; additional stepping was necessary.
- `cancel-epoch-red.log`:1failed/9filtered, replacement run wrongly received resume and25steps. Per-await epoch/run/writer guard fixes it.
- `pause-label-red.log`:2failed/10filtered: second Pause ignored and mobile readiness titled IR-SIM. Now pauses interrupt observation and the provider is explicitly MuJoCo.
- `load-binding-red.log`:1failed/12filtered, a rehashed cup-radius substitution was accepted. Admitted load supports/props now match the pinned fixture, independent of the shape's own digest.
- `calibration-red.log`:1failed/14filtered, mobile report falsely claiming calibrated dynamics was accepted; now refused.
- `create-zero-red.log`:1failed/15filtered, payload create called start+step; now start only.
- `cursor-red.log`:1failed/16filtered, payload terminal slider still step5. The actual native run had independently exposed unequal live/replay poses at terminal284. Conditional logical step1 fixes it.

Intermediate browser failures are retained as development logs: an initial harness had a wrong pair selector and was interrupted via its exact owned wrapper; a hot reload while editing reset its one-use page (not product/native proof). Later harness timing was corrected to wait for readiness/Source cancellation before creation/import. The valid tick370 journeys and screenshots were superseded by the tick0 correction; the final journey below is authoritative. No unresolved failing run is hidden.

## GREEN / focused checks

All commands run from Lab with `PATH=/Users/hoangpham/.nvm/versions/node/v24.22.2/bin:$PATH`; native `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`.

1. `perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/unit/payload-view.test.ts tests/unit/navigation2d-report.test.ts tests/unit/physics-report-shape.test.ts tests/unit/mujoco-coffee.test.ts tests/unit/twin3d-structure.test.ts tests/unit/twin3d-layers.test.ts tests/unit/live-playback.test.ts tests/unit/pose3d.test.ts tests/unit/workspace-navigation-scene.test.ts tests/unit/workspace-replay-freshness.test.ts tests/unit/report-metrics.test.ts tests/unit/controller-report.test.ts tests/unit/irsim-controls.test.ts tests/unit/native-controls.test.ts`:14files/98passed, no skips (`focused-final.log`). This preceded the final payload-only clock/cursor correction; unchanged coverage was not broadly repeated, per controller direction.
2. Final changed clock/cursor/control checks: `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/payload-view.test.ts tests/unit/native-controls.test.ts tests/unit/irsim-controls.test.ts`:3files/25passed, no skips (`clock-controls-final.log`), including17payload tests. Covers rotated tray/relative-load/map conversion, independent free cup, empty selection, new identity, malformed/old reports, current/future/gapped replay, async compile race, paused cancellation, stale epoch/view-only/attention/unknown/second Pause, tick0 no-step and exact terminal cursor.
3. `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-launcher.test.ts`:1file/6passed, no skips (`launcher-final.log`). Covers old arm capability/defaults, mobile opt-in health, missing Python and tool-root/symlink data-dir refusal before ports open.
4. Real arm-only positive boot: `node scripts/start-irsim.mjs --provider mujoco --boot-only --data-dir /tmp/mekoniq-b04b-arm-boot-final-20261114-1051`, through an owned child/redactor under a90s alarm: EXIT_CODE=0, pinned runtime and only mock+mujoco_arm, clean owned teardown (`arm-boot-final.log`). Ports4175/4176 free afterwards. This does not claim an arm mission rerun.
5. `perl -e 'alarm 90; exec @ARGV' pnpm typecheck`:exit0 (`typecheck-final.log`). `perl -e 'alarm 90; exec @ARGV' pnpm check:source`:exit0, exact reviewed source/schema/protocol1/2/Node24 (`source-check-final.log`). `node scripts/sync-engineering-contracts.mjs --check`:exit0 (`sync-check-final.log`). These pin/schema checks are unchanged by the payload-only clock correction. Diff checks clean.

### Final actual-provider browser command

```sh
LAB_PAYLOAD_REPLAY_DIR=/tmp/mekoniq-b04b-cup-fall-replay-20261114-1022 \
LAB_IRSIM_SCREENSHOTS=/tmp/mekoniq-b04b-browser-zero-final-20261114-1049 \
perl -e 'alarm 240; exec @ARGV' pnpm test:mujoco-e2e -- --mujoco-mobile mujoco-payload.spec.ts
```

`browser-zero-final.log`:1/1passed,14.9s test/16.2s total, owned launcher teardown, no page errors/skips. Startup showed source681b8ad/artifact9151185264c5 with actual mobile+arm providers. One spec/one-use pairing, no protocol double presented as native. Retained Playwright warning: NO_COLOR ignored because FORCE_COLOR is set; validation noise only. No native run was repeated merely to remove it.

The journey checks preset→exact compile/readiness→Source start/native tick0 observation→explicit1× Play/actual AMR+cup change→Pause→Cancel/observed Source cancelled→report→exact matching replay→new empty experiment (new bundle/project/run)→read-only real recorded fall. It tests VI/JA/EN labels, keyboard object selection+Fit,390px no horizontal scroll, 2D/3D switching, reduced-motion freeze, and a separate page with runtime requests aborted (no-runtime Run disabled). The latter is only UI-absence proof, not engine evidence. It checks no future metric/fault at cursor0. Full touch-device/screen-reader/WEB04/performance qualification remains not_run.

## Final screenshots and identities

Directory `/tmp/mekoniq-b04b-browser-zero-final-20261114-1049/` contains `identities.json` and:

- `B04b-live-desktop.png`: actual native initial observation at tick0 before Play.
- `B04b-stopped-desktop.png`, `B04b-stopped-390.png`: native stopped tick284.
- `B04b-replay-matching-desktop.png`, `B04b-replay-matching-390.png`: exact same run/object/pose at cursor284.
- `B04b-recorded-fall-tick520-desktop.png`, `B04b-recorded-fall-tick520-390.png`: original real fall at its last committed520; readable phone import notice, frozen stale wireframe pose.

I inspected all six matching/fault PNGs individually with view_image. Actual-sized cup/tray are legible at desktop/390; no exaggerated geometry. A real support rod can partially occlude the cup from this fixed viewing direction; existing orbit and Fit remain available. Earlier directories1019/1023/1024/1027/1028/1031/1033/1035/1040/1041/1045/1047 are superseded development captures, not final proof.

Native run `ef468a50-70c0-451f-9f3f-ae1ab5e58a6f`, boot `c2d75695-c10d-42a9-8a0d-f675d58c3b9c`, seed7, finaltick284 (5.68s). Initial payload sample seq2, simTimeNs0, physics_sim/map/valid, same boot, source position `[1.8640861958632682, 1.4999996522724348, 0.5675243005709967]`. Actual model file-byte SHA256 `9a416e1c783c01627c402171ef4ccbaf60e05d4d67a2d04724bd71d90d262a41`; load SHA256 `0290f280969726aadde1137c502f128738912e4b08c9328b1af4fd6c914ecfc5`; scene digest `dc90f74bdeb9ddbb88bfae21fe0fad6c0e456dacf1165a598b56406b87e9f710`. Native bundle `36d9b9b6454c26a91a967078ffd8df021abb923fb685666a9b2d7358f1b4d966`, projectdigest `77f0a996daef4b4c54e22865149d64fa6d7a4b467873cad6157361b5d547374b`.

Empty run `a139094d-fea6-4f97-b6f4-7bb529625637`, bundle `bb58c68e70247e65238e1714180162032c667d90ab16cd6f7c0afcc875fb1ba0`, projectdigest `b9fa77ec97522fe10cbc4636a4dcd3f30b31d1edb93fa97d4a2ad8b3ced6c668`.

Fault reuses the reviewed B04a case `/tmp/mekoniq-b04a-final-681b8ad-20261114-0954/cup-fall`: run `69dd0480-e1d6-4707-8be6-6f77052eac8b`, boot `8a2e5b93-4c44-46c9-9738-2d542741453f`, seed7, tick520; actual cup position `[1.997719006442835,2.03698275648675,0.3022429680849584]`, quaternion `[-0.5868844155998478,0.6617719749068989,0.3230042889452486,0.3365899066769865]`. Still falling at the terminal observation; frozen there. Original19-case campaign/probes were not rerun or rewritten. Exported read-only browser folder was prepared with `node scripts/export-payload-replay.mjs <case> /tmp/mekoniq-b04b-cup-fall-replay-20261114-1022` and preserves hash-bound public inputs/chunks.

## Files and self-review

- `README.md`
- `fixtures/engineering/serve-payload-v1/NOTICE`
- `fixtures/engineering/serve-payload-v1/cup-center.json`
- `fixtures/engineering/serve-payload-v1/cup-offset.json`
- `fixtures/engineering/serve-payload-v1/empty.json`
- `fixtures/engineering/serve-payload-v1/manifest.json`
- `fixtures/engineering/serve-payload-v1/navigation-scene.json`
- `fixtures/engineering/serve-payload-v1/physical-model-amr-1.json`
- `fixtures/engineering/serve-payload-v1/serve-3d-project.json`
- `scripts/export-payload-replay.mjs`
- `scripts/start-irsim.mjs`
- `scripts/sync-engineering-contracts.mjs`
- `src/i18n/index.ts`
- `src/reports/evidence.ts`
- `src/reports/metrics.ts`
- `src/reports/navigation2d.ts`
- `src/reports/physics.ts`
- `src/reports/replay.ts`
- `src/reports/report-shape.ts`
- `src/scenarios/catalog.ts`
- `src/scenarios/controls.ts`
- `src/scenarios/support.ts`
- `src/shared/engineering-schemas/load-profile-v1.schema.json`
- `src/shared/engineering-schemas/navigation-model-2d-v1.schema.json`
- `src/shared/engineering-schemas/navigation-scene-v1.schema.json`
- `src/shared/engineering-schemas/twin-sample-v2.schema.json`
- `src/styles/main.css`
- `src/twin/inspector.ts`
- `src/twin/live-playback.ts`
- `src/twin/payload.ts`
- `src/twin/scene.ts`
- `src/ui/operations-panel.ts`
- `src/ui/report-panel.ts`
- `src/ui/transport.ts`
- `src/ui/workspace.ts`
- `src/viewer/twin3d.ts`
- `tests/e2e/mujoco-payload.spec.ts`
- `tests/integration/mujoco-launcher.test.ts`
- `tests/unit/navigation2d-report.test.ts`
- `tests/unit/payload-view.test.ts`

Generated schemas and fixture bodies were copied only by sync-engineering-contracts from the clean reviewed source; exact manifest hashes verified. Large insertion count is chiefly those source JSON copies. No shared model compiler parity file was edited. Source SHA/pin unchanged, no generated type body hand-edit. Existing brand/vanillaTS/Vite/Three retained.

Self-review traced source/native observation authority, project→bundle→model/load binding, immutable imported/source metric distinction, map/Three transform boundary, replay missing/future visibility, resource disposal, clock ownership, per-await cancellation epoch/access guards and old provider paths. Found/fixed the unpaced payload bootstrap and exact cursor sanitization defect before commit. UI notice phone wrap and stale wireframe provenance were checked visually. No unresolved issue remains; independent scoped review still required.

## Limits / not_run

- No whole-branch CI/build/performance/WEB04 repeat; B07/B10 own broader qualification. No actual touch-device, full screen reader, large system text or new full arm mission browser run; focused legacy unit/launcher paths above ran.
- No Source API/runtime/schema/portable tool change, source campaign/probe rerun, source re-export, hardware/Linux/ROS/Gazebo commissioning, native device gate or accepted:true record.
- Live named stress and full offline catalogue are B07. This task's visible fault is the validated read-only real B04a recording. Imported aggregate metrics stay unavailable/unverified; browser does not recompute raw physics or establish an external producer trust anchor.
- Live LiDAR/force-vector streams absent from this view are explicitly unavailable, never invented. Normal cancel lacks the source five-sample stop metric; its unavailable result is preserved.
- Existing generic exports/redaction behavior remains; portable read-only replay preparation uses the explicit public campaign exporter, not a claim that arbitrary redacted downloads are executable/native evidence.

## Final commit / clean handoff

Lab BASE `cbeb5817cd65d53182aa080df3e566ad656d4945` → HEAD **`81d619dc514039c6aea6d0bd88b15159575c5955`**, `feat: add native MuJoCo payload experiments to Lab` (40files; most insertions are hash-verified source JSON fixtures/schemas). Source BASE=HEAD remains `681b8adb8ed473f7195062773b23fabc3b922cd5`. Both worktrees clean after commit; no push. Final staged diff self-reviewed and diff checks clean. No remaining correctness concern identified; independent scoped review is the controller's next step.

## Review fix round 1 — I1/I2 (2026-11-14)

Review `task-B04b-review-1.md` identified two real gaps in the original handoff. This appendix supersedes its no-remaining-concern statement for those gaps. Fix BASE is Lab `81d619dc514039c6aea6d0bd88b15159575c5955`; Source remains `681b8adb8ed473f7195062773b23fabc3b922cd5`. No source edit/export, pin change, original artifact modification or campaign/probe repeat was needed. M1 (NO_COLOR/FORCE_COLOR warning) is explicitly deferred by the controller.

### Changes and regression boundaries

I1: `src/reports/navigation2d.ts` now binds mobile navigation engine version/timestep/substeps and clock to the independently validated scene; compares complete load/physics/stop/controller refs (id/revision/path/SHA); binds navigation policy and model digests to scene policy/models; and checks duplicated manifest provider/version/policy/model/scene identity. A foreign navigation engine cannot disguise mobile telemetry/backend evidence. Inline physics identity is checked against admitted load bytes and scene physics/stop refs, so report and physics cannot validate each other while agreeing on false digests. Imported metrics remain unavailable/unverified. Legacy provider admission/policy is preserved.

I2: `src/ui/report-panel.ts` exposes the existing mobile final-cursor policy through `navigationAtCursor` and a stable `twin-navigation-evidence` region. `src/ui/workspace.ts` updates that region in the actual `input` → `scrubbed` path in both directions. The focused range is outside the updated region and retains its actual DOM node/focus. Final105/105 coverage/assertions disappear at0 and return at520; other providers retain full-run evidence behavior.

`tests/unit/payload-import-scrub.test.ts` adds14 tests: valid import;12 binding mutations (colluding/rehashed report+physics load/physics/stop digests; controller digest; load ref id/revision/path; colluding policy/model refs; duplicate manifest engine/policy; foreign report engine); and the actual workspace input/scrub update with focused-range preservation. Its synthetic folder uses pinned fixture bytes and is trust-boundary test data, never native evidence. `tests/e2e/mujoco-payload.spec.ts` exercises early→final→early for the native report and direct imported terminal520→0→520, including unchanged focused range ElementHandle and hidden/restored coverage/assertions.

### RED then GREEN evidence

Commands ran from Lab with Node24 PATH as above; logs are in `evidence-B04b/`.

- RED: `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/payload-import-scrub.test.ts` on unchanged production:13cases,12failed/1passed (`r1-red.log`). Binding mutations were accepted and the actual backward scrub retained105/105. This was behavior failure, not only a formatter assertion.
- A later cross-provider case initially used an invalid Webots seed enum, so schema rejection was a fixture error, not a valid product RED. It was corrected to generated-contract `webots-worldinfo-seed-v1`. With only the new foreign-engine guard temporarily removed, `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/payload-import-scrub.test.ts -t 'mobile import binds report-engine'` failed as expected (accepted import instead of identity rejection;1failed/13filtered, `r1-engine-red.log`); guard restored. Filters are not claimed as passes. An intermediate fixture metrics cast failed typecheck and was corrected without weakening assertions.
- GREEN: `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/payload-import-scrub.test.ts tests/unit/navigation2d-report.test.ts tests/unit/physics-report-shape.test.ts tests/unit/workspace-navigation-scene.test.ts tests/unit/report-metrics.test.ts tests/unit/native-controls.test.ts`:6files/43passed,0failed, no skips (`r1-focused.log`). Includes legacy IR/Webots policy checks. Intermediate `r1-i1-green.log`/`r1-green-first.log` are development evidence only.
- `perl -e 'alarm 90; exec @ARGV' pnpm typecheck`:exit0 (`r1-typecheck.log`). `perl -e 'alarm 90; exec @ARGV' pnpm check:source`:exit0 with unchanged reviewed Source681b8ad/schema/protocol (`r1-pin.log`). `node scripts/sync-engineering-contracts.mjs --check`:exit0 (`r1-sync.log`). Diff whitespace checks clean.

One affected actual-provider journey was repeated, with `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`:

```sh
LAB_PAYLOAD_REPLAY_DIR=/tmp/mekoniq-b04b-cup-fall-replay-20261114-1022 \
LAB_IRSIM_SCREENSHOTS=/tmp/mekoniq-b04b-r1-browser-20261114-1111 \
perl -e 'alarm 240; exec @ARGV' pnpm test:mujoco-e2e -- --mujoco-mobile mujoco-payload.spec.ts
```

`r1-browser.log`:1/1passed,16.5s test/18.5s total, no skips/page errors, exact reviewed source/runtime, owned launcher teardown. The new input→scrub navigation assertions run against the real DOM with no unrelated full rerender between transitions. Existing native motion/report/replay, empty/new identity, VI/JA/EN, keyboard,390px, reduced motion,2D and no-runtime assertions also pass in that same journey. Retained M1 warning is validation noise. No second native run was made for screenshots or warning cleanup. Broader98-case suite, full source suites, campaign and probes were not repeated.

### New final identity and visual evidence

Directory `/tmp/mekoniq-b04b-r1-browser-20261114-1111/`, `identities.json`: native run `b85fcc6d-589e-41ee-bea2-8aa79f7cd334`, boot `fee0c48d-71e2-48aa-8c12-55b3f9db9c0d`, seed7, real worker initial tick0 and final284. Engine MuJoCo3.17.0, timestep2ms/substeps10; model fileSHA `9a416e1c783c01627c402171ef4ccbaf60e05d4d67a2d04724bd71d90d262a41`, scene `dc90f74bdeb9ddbb88bfae21fe0fad6c0e456dacf1165a598b56406b87e9f710`, loadSHA `0290f280969726aadde1137c502f128738912e4b08c9328b1af4fd6c914ecfc5`. Bundle/project hashes match the original final proof. New empty run `9548d1d0-a297-4811-bc19-afe12e752169`. Recorded fault remains original run `69dd0480-e1d6-4707-8be6-6f77052eac8b`/boot `8a2e5b93-4c44-46c9-9738-2d542741453f`, frozen committed520 with unchanged actual pose/geometry; no motion beyond that observation.

The new directory contains `B04b-live-desktop.png`, all four `B04b-stopped-{desktop,390}.png`/`B04b-replay-matching-{desktop,390}.png`, and both `B04b-recorded-fall-tick520-{desktop,390}.png`. Controller confirmed all four stopped/matching PNGs are byte-identical to the individually inspected prior final images; the new identities establish the new run. No geometry rendering changed in this fix.

Native `B04b-import-navigation-cursor0-report.png`/`B04b-import-navigation-cursor520-report.png` capture the successful transitions, but the sidebar was scrolled below navigation. Supplemental **UI-only** captures make that region visible: `B04b-navigation-visible-cursor0.png` and `B04b-navigation-visible-cursor520.png`, with `navigation-visible-identities.json`. I inspected these images with view_image:0 shows the final-cursor placeholder without final coverage/assertions;520 shows0–520 coverage,105/105 and assertions restored. An owned Vite UI with all runtime routes aborted imported the same validated retained folder and exercised520→0→520 preserving actual focused node, then stopped its owned process (`r1-nav-visual.log`, PASS). No native runtime was started for these supplemental captures; they prove UI visibility, not motion. All captures are outside repos/tool roots. Ports4175/4176 were free after owned teardown.

Self-review inspected the five-file diff and traced validation order, independent scene/load authority, mutation sensitivity, stable region/focus and legacy behavior. No additional correctness issue or scope expansion identified. Existing limits/not_run above remain. Independent scoped I1/I2 rereview is required before B05.

Round1 commit: Lab `81d619dc514039c6aea6d0bd88b15159575c5955` → **`cb09dc1f7f0f0a241869f15e42c1c4059b00b336`**, `fix: bind payload imports and refresh replay navigation` (5files,74insertions/6deletions). Source BASE=HEAD `681b8adb8ed473f7195062773b23fabc3b922cd5`. Both authorized worktrees have clean tracked/untracked Git status after commit; report/evidence remain in the source ignored task ledger. No push.
