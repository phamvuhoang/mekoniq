# L01 scoped fix-round1 re-review

**Final fix-round verdict: REQUEST CHANGES.** The four original Important findings are addressed in their specified scope, but the fix introduces one Important writer/reader incompatibility, **L01-R2-01**, which prevents otherwise successful business and worker-loss records from qualifying. No new Critical finding. This is a preparation-tooling verdict, not native qualification.

## Scope and identity

Reviewed only the supplied fix packages and the four findings in `review-L01-r1-dispatch.md`, including the recorder unit-test isolation follow-up. No full-task re-review or helper delegation.

| Repository | Previous-reviewed BASE | Final HEAD |
| --- | --- | --- |
| Source | `2f4837d10d746a7c8c5e5ca5675ec57db4111c28` | `eeea18db88485e113aafe1cc15edd7f75ced2b66` |
| Lab | `69032d509cc94b178102c386ddf82280996cf74e` | `e8577a5b7f4f6b615aa333b3f86126d06e1f0c05` |

Read-only HEAD/status checks confirmed those heads and clean working trees. Supplied package bytes independently match Source SHA256 `91d8b7f4420357df28b82a9a6f2213efc6df60fbffd2575740086f4bf9550f32` (154,794 bytes) and Lab SHA256 `c845ae555acd9e2f7af0db767eec5cf2b307f72cb86d4651529d4878be457c10` (3,475 bytes). Lab changes remain the runtime lock and two generated Source-commit headers.

## Original findings

### L01-R1-01 — ADDRESSED

`scripts/native-checker-bootstrap.mjs:8` performs the builtin-only clean Git/blob audit. Public probe and preparation entrypoints now import only trusted bootstrap code and builtins. `probe-bootstrap.mjs:7–13` audits before forking a fresh fixed worker, removes inherited `NODE_OPTIONS`/`NODE_PATH`, uses empty `execArgv`, and audits after completion. `probe-worker.mjs:8–19` checks the expected tuple before importing either core, supplies the audited identity after caller input, and performs the post-assessment audit for run/verify/read/copy/prepare. The recorder still calls the public supplement API, so that path gains the same boundary; cached caller reference modules cannot become the fresh worker's assessment modules.

The nine security cases cover dirty imported helpers through probe/preparer/supplement, a poisoned caller JSON cache with restored disk bytes, and mutations during all five operations. The recorded combined run includes all nine passing. This addresses the original load/check/use and supplement-entrypoint defect; internal core modules are expressly not qualification entrypoints.

### L01-R1-02 — ADDRESSED

`mujoco-probe-core.mjs:92` compares the recorded checker with the audited reader tuple; line 124 independently requires it for supplements. The tuple includes the exact Source commit and the digest of the audited tracked tree listing, covering orchestration, reader, references and helpers. Missing or altered checker fields cannot be accepted through public readback/copy.

`imagePrerequisites` in `mujoco-probe-evidence.mjs:104` is called by execution (`mujoco-probe-core.mjs:81`) and independent readback (line 106). It requires the exact historical registry digest, one required package lock, the measured MuJoCo 3.17.0 package, normalized forbidden-package exclusion, and the locked engine-library digest. Focused tests cover missing/changed checker members, another image digest, normalized forbidden-package spelling and extra required packages. No image resolution policy was relaxed, and no native image was constructed or inferred.

### L01-R1-03 — ADDRESSED, with a new integration blocker below

`mujoco-probe-raw.mjs:7–34` now reads the original JSONL stream, checks final newline/exact seal byte count/absence of an incomplete marker, enforces run/PID/time scope and lifecycle, and compares the whole stream with both derived arrays. `analyseWire` additionally rejects duplicate spawn and traffic after exit. Raw injection, retained post-close checkpoint, trace/props and HTTP requests are compared with their asserted values; the container now reads its checkpoint summary from the copied post-close file (`mujoco-probe-container.mjs:72`).

`mujoco-probe-raw.mjs:39–66` decodes the three retained NPZ states with the bounded, uncompressed float64-only reader, validates historical dimensions and the single J1 qvel NaN injection, and binds warnings, snapshots, all four requests/responses, scene/component/physics and compiled MJCF. The added raw-source substitution tests include truncated/resend/byte-count/marker/checkpoint/injection/request and state/scene/compiled/warning/snapshot/dimension/CRC negatives. The former unchecked-summary paths are therefore addressed. However, the newly required HTTP request equality exposes an incompatible writer lifecycle; L01-R2-01 must be fixed before this fix round can close.

### L01-R1-04 — ADDRESSED

`mujoco-probe-engine.py:37–41,116–119` installs the separately hashed retention observer for both nominal M00 and long-run execution and finalizes it on normal return or exception. `mujoco-probe-retention.py:42–95` retains qpos/qvel/qacc/ctrl, warnings, original parameters/MJCF, bounded last commands/samples, periodic state, and first warning/exception state. Exceptions are re-raised, nonfinite values are retained explicitly, and absent constructor state is reported honestly. The observer is included in staging and readback pin checks.

The frozen recipe's actual constructor/tick signatures and `d`/`log` attributes match the wrapper; its command and return forwarding does not change the historical recipe bytes. Nine portable Python tests cover thrown instability, returned warnings, analysis exceptions, bounded periodic retention and harness installation/finalization for both modes. These are fake-engine tests. They establish the prepared retention behavior, not real MuJoCo failure observations or native timing. The documented abrupt-loss checkpoint limitation remains.

## New Important blocker

### L01-R2-01 — Persist the completed HTTP request state before requiring raw-summary equality

**Severity:** Important. **Introduced location:** `scripts/native-sim/mujoco-probe-raw.mjs:22`; wired into qualification at `scripts/native-sim/mujoco-probe-core.mjs:113`. **Concrete dependency:** the existing writer at `scripts/native-sim/mujoco-probe-container.mjs:47`, with result construction at line 65.

The new reader requires `requests.json` to equal `raw.requests`. In `act()`, the writer appends a request with `received:false` and saves the array **before** awaiting the HTTP action. After success it changes the in-memory object to `received:true`, but never saves that completed state. A subsequent action incidentally persists the preceding request's update; the final action has no subsequent save. Report/archive calls use `api()` directly and do not rewrite the request file.

Thus, after any successful business case or worker-loss case, the final entry in retained `requests.json` is `received:false`, while the same entry in `result.json` is `received:true`. The new equality check deterministically returns `HTTP_REQUEST_BYTES`. All three MJ-BV01 cases and the worker-loss case are affected, so a full successful native campaign cannot pass independent readback or be attached as a passed supplement. This is an incompatibility introduced by the fix's new check, not a request to broaden the old task.

Keep the pre-dispatch persistence that retains attempted requests, and also persist the completed request state after a successful response before constructing the final result. Add a focused portable writer-to-reader regression for the final successful action and preserve the unsuccessful/in-flight behavior. The existing helper tests write a matching synthetic request file directly and therefore do not exercise this writer ordering. No native/Docker run is necessary to establish or fix this issue.

## Evidence and limits

Read the full 40,356-byte implementation report, its appended Docker-activity correction, the root handoff and root byte-audit summary, and the covering outputs. `fix1/combined-final.log` records **182 Vitest passes in six files**; `retention-venv311.log` records **nine portable Python passes**. These belong to the preceding fix1 tree handed off as `bb62601`, not reruns on `eeea18d`. The report gives the exact six-suite Vitest and isolated Python commands. Typecheck/contracts outputs pass; lint output is empty as reported by the handoff.

At final `eeea18d`, `plan-test-isolation/focused-committed-green.log` records **one focused test passed, 24 unselected/not_run**, with `focused-check-source.txt` identifying the commit. Receipts identify only the owned stub executable, argv `['info']`, and the deliberate invalid-argv refusal; exclusive PATH prevents fallback to host Docker. Source typecheck and final Lab source-pin output pass. This test-only change introduces no additional blocker.

The correction is material: the earlier combined test invoked the real inherited read-only `docker info` prerequisite via production `--plan`; the 30,292 ms test duration does not establish its unretained child status, daemon state or any container result. Broad earlier no-Docker verification claims are withdrawn. Production `--plan` remains unchanged. I did not invoke it or rerun any suite.

Independently read the actual final handoff and not-run manifests under `/tmp/mekoniq-L01-fix1-isolated-preparation-1sLaHG/` and checked their manifest hashes: handoff `f8e4755506ffb36bc2cd93dddbbe2ff96eb81e0e1d3aed8e681cf042c1a53dac`, probe `deb9af0d37d89dc283b0cb37efa3d838ee55dd61a2291e0ee1ef644c7f98a38d`. They retain historical Source `4f893ac6fb75dff414a3ee42a726defb7935c734`, Lab `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`, runtime `55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270`, and `image:null`. The checker is final Source `eeea18d…` with full-graph digest `abb467b33ad9011efbf3867e3ce6fd91aa080f8763e7be03736749a540f6a378`. The probe contains all 16 cases `not_run` and `NATIVE_AMD64_HOST_UNASSIGNED`.

The root's supplied audit, rather than a repeated historical re-audit here, establishes the reported 184 refs / 9,648,529 bytes, preserved report prefixes, four old artifact sets and 51+27 log files. Those are byte/identity claims only. Current Lab runtime `a0389ddd56cc96c3c3116a00e2f1b7e433b6ae06b90627d4578754ae6bb0dded` remains separate from the historical subject.

Outside the diff, reads were restricted to named dependencies: the container's request persistence/result construction and existing `assessCase` interaction for the new raw-reader contract; the recorder supplement call site for the public bootstrap boundary; and the frozen Git recipe's Sim API for retention-wrapper compatibility. No historical SQLite was opened. No native host, engine, Docker, cloud or hardware execution occurred during this review; no code, index or HEAD was changed. Only this report was written.

L01-R1-05 remains deferred Minor for B10/final triage. R81 exact historical arm-only identity, R82 component versus full-runtime fault scopes, R83 current-R2b adapter ownership in B10, and R84 explicitly identified passive observation remain binding. Source authority, one ACK, unknown/no-resend/no-respawn policies and immutable historical evidence are preserved. Native qualification remains **not_run**, `accepted:false`, dynamics `not_calibrated`.
